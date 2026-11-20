//! Local checkout of a PR's head branch in a linked repository.
//!
//! Safety rules:
//! - The checkout's `origin` must point at the PR's `owner/repo`.
//! - Uncommitted changes to tracked files block the checkout (no auto-stash).
//! - Existing local branches are only ever fast-forwarded, never reset.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;

use super::git::parse_remote_owner_repo;
use super::hidden_command;

const MAX_DIRTY_FILES_IN_ERROR: usize = 10;

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepoStatus {
    /// Current branch, or `None` when HEAD is detached.
    pub branch: Option<String>,
    /// HEAD commit, or `None` in a repository without commits.
    pub head_oid: Option<String>,
    /// Tracked files with uncommitted changes (untracked files are ignored).
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutPrRequest {
    pub repo_path: String,
    /// `owner/repo` the PR belongs to; must match the checkout's `origin`.
    pub expected_owner_repo: String,
    pub number: u64,
    pub head_ref_name: String,
    /// `true` when the PR's head branch lives in a fork.
    pub is_cross_repository: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutPrResult {
    pub branch: String,
    pub head_oid: String,
    /// A new local branch was created.
    pub created: bool,
    /// An existing local branch was fast-forwarded to the PR head.
    pub fast_forwarded: bool,
    /// The local branch has commits that are not in the PR head; it was left as-is.
    pub local_ahead: bool,
}

fn run_git(repo: &str, args: &[&str]) -> Result<String, String> {
    run_git_raw(repo, args).map(|out| out.trim().to_string())
}

fn run_git_raw(repo: &str, args: &[&str]) -> Result<String, String> {
    let output = hidden_command("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        // Never block on an interactive credential prompt from a GUI app.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "git {} failed: {}",
            args.first().copied().unwrap_or_default(),
            stderr.trim()
        ))
    }
}

fn git_succeeds(repo: &str, args: &[&str]) -> bool {
    run_git(repo, args).is_ok()
}

/// Parses `git status --porcelain=v1 -z` output into file paths.
pub fn parse_porcelain_status(stdout: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut entries = stdout.split('\0');
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let (code, path) = entry.split_at(3);
        files.push(path.to_string());
        // Renames/copies are followed by an extra entry holding the original path.
        if code.starts_with('R') || code.starts_with('C') {
            entries.next();
        }
    }
    files
}

/// Local branch name used for a PR: the head branch for same-repo PRs, `pr/<n>` for forks
/// (a fork's branch name can collide with an unrelated local branch, e.g. `main`).
pub fn local_branch_for_pr(number: u64, head_ref_name: &str, is_cross_repository: bool) -> String {
    if is_cross_repository {
        format!("pr/{number}")
    } else {
        head_ref_name.to_string()
    }
}

/// Conservative branch-name check applied before any name reaches a git command line.
pub fn is_safe_branch_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.ends_with('.')
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("@{")
        && !name.contains("//")
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
}

/// Whether a remote URL points at `expected` (`owner/repo`, case-insensitive like GitHub).
pub fn remote_matches_owner_repo(remote_url: &str, expected: &str) -> bool {
    parse_remote_owner_repo(remote_url)
        .is_some_and(|actual| actual.eq_ignore_ascii_case(expected.trim()))
}

fn ensure_work_tree(repo: &str) -> Result<(), String> {
    if !Path::new(repo).is_dir() {
        return Err(format!("Linked checkout does not exist: {repo}"));
    }
    match run_git(repo, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) if out == "true" => Ok(()),
        _ => Err(format!("Linked checkout is not a git work tree: {repo}")),
    }
}

pub fn local_status(repo: &str) -> Result<LocalRepoStatus, String> {
    ensure_work_tree(repo)?;
    let branch = run_git(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    let head_oid = run_git(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).ok();
    let porcelain = run_git_raw(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=no"],
    )?;
    Ok(LocalRepoStatus {
        branch,
        head_oid,
        dirty_files: parse_porcelain_status(&porcelain),
    })
}

fn verify_origin(repo: &str, expected_owner_repo: &str) -> Result<(), String> {
    let url = run_git(repo, &["remote", "get-url", "origin"])
        .map_err(|_| "Linked checkout has no 'origin' remote.".to_string())?;
    if remote_matches_owner_repo(&url, expected_owner_repo) {
        Ok(())
    } else {
        Err(format!(
            "Linked checkout's origin ({url}) is not {expected_owner_repo}. Re-link the checkout in Settings."
        ))
    }
}

fn dirty_error(files: &[String]) -> String {
    let mut msg = String::from(
        "The linked checkout has uncommitted changes. Commit or stash them before checking out:",
    );
    for f in files.iter().take(MAX_DIRTY_FILES_IN_ERROR) {
        msg.push_str("\n  ");
        msg.push_str(f);
    }
    if files.len() > MAX_DIRTY_FILES_IN_ERROR {
        msg.push_str(&format!(
            "\n  …and {} more",
            files.len() - MAX_DIRTY_FILES_IN_ERROR
        ));
    }
    msg
}

/// Fetches the PR head and switches to it. Does not verify `origin`; see [`checkout_pr`].
fn checkout_pr_unverified(req: &GitCheckoutPrRequest) -> Result<GitCheckoutPrResult, String> {
    let repo = req.repo_path.as_str();
    if req.number == 0 {
        return Err("Invalid pull request number.".to_string());
    }
    if !req.is_cross_repository && !is_safe_branch_name(&req.head_ref_name) {
        return Err(format!(
            "Refusing to check out unusual branch name '{}'.",
            req.head_ref_name
        ));
    }

    let status = local_status(repo)?;
    if !status.dirty_files.is_empty() {
        return Err(dirty_error(&status.dirty_files));
    }

    let branch = local_branch_for_pr(req.number, &req.head_ref_name, req.is_cross_repository);
    if !git_succeeds(repo, &["check-ref-format", "--branch", &branch]) {
        return Err(format!("'{branch}' is not a valid branch name."));
    }

    // 1. Fetch the PR head.
    let target_oid = if req.is_cross_repository {
        let pull_ref = format!("refs/pull/{}/head", req.number);
        run_git(repo, &["fetch", "--no-tags", "origin", &pull_ref])?;
        run_git(repo, &["rev-parse", "--verify", "FETCH_HEAD^{commit}"])?
    } else {
        let refspec = format!("+refs/heads/{0}:refs/remotes/origin/{0}", req.head_ref_name);
        run_git(repo, &["fetch", "--no-tags", "origin", &refspec])?;
        let tracking = format!("refs/remotes/origin/{}^{{commit}}", req.head_ref_name);
        run_git(repo, &["rev-parse", "--verify", &tracking])?
    };

    // 2. Create or fast-forward the local branch, then switch to it.
    let local_ref = format!("refs/heads/{branch}");
    let exists = git_succeeds(repo, &["show-ref", "--verify", "--quiet", &local_ref]);
    let on_branch = status.branch.as_deref() == Some(branch.as_str());

    let mut created = false;
    let mut fast_forwarded = false;
    let mut local_ahead = false;

    if !exists {
        run_git(repo, &["switch", "--no-track", "-c", &branch, &target_oid])?;
        created = true;
        if !req.is_cross_repository {
            let upstream = format!("origin/{}", req.head_ref_name);
            // Best effort: narrow fetch refspecs can make the tracking ref unusable.
            let _ = run_git(repo, &["branch", "--set-upstream-to", &upstream, &branch]);
        }
    } else {
        let local_oid = run_git(repo, &["rev-parse", "--verify", &local_ref])?;
        if local_oid != target_oid {
            if git_succeeds(
                repo,
                &["merge-base", "--is-ancestor", &local_oid, &target_oid],
            ) {
                if on_branch {
                    run_git(repo, &["merge", "--ff-only", &target_oid])?;
                } else {
                    // Refuses (with a clear error) if the branch is checked out in another worktree.
                    run_git(repo, &["branch", "-f", &branch, &target_oid])?;
                }
                fast_forwarded = true;
            } else if git_succeeds(
                repo,
                &["merge-base", "--is-ancestor", &target_oid, &local_oid],
            ) {
                local_ahead = true;
            } else {
                return Err(format!(
                    "Local branch '{branch}' has diverged from the PR head (was it force-pushed?). \
                     Rename or delete the local branch and try again."
                ));
            }
        }
        if !on_branch {
            run_git(repo, &["switch", &branch])?;
        }
    }

    let head_oid = run_git(repo, &["rev-parse", "HEAD"])?;
    Ok(GitCheckoutPrResult {
        branch,
        head_oid,
        created,
        fast_forwarded,
        local_ahead,
    })
}

pub fn checkout_pr(req: &GitCheckoutPrRequest) -> Result<GitCheckoutPrResult, String> {
    ensure_work_tree(&req.repo_path)?;
    verify_origin(&req.repo_path, &req.expected_owner_repo)?;
    checkout_pr_unverified(req)
}

/// Current branch / HEAD / uncommitted files of a linked checkout.
#[tauri::command]
pub async fn git_local_status(repo_path: String) -> Result<LocalRepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || local_status(&repo_path))
        .await
        .map_err(|e| format!("Status task failed: {e}"))?
}

/// Fetches a PR's head and checks it out in the linked checkout.
#[tauri::command]
pub async fn git_checkout_pr(request: GitCheckoutPrRequest) -> Result<GitCheckoutPrResult, String> {
    tauri::async_runtime::spawn_blocking(move || checkout_pr(&request))
        .await
        .map_err(|e| format!("Checkout task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_porcelain_status_lines() {
        let out = " M src/a.ts\0M  src/b.ts\0R  new.ts\0old.ts\0 M has space.ts\0";
        assert_eq!(
            parse_porcelain_status(out),
            vec!["src/a.ts", "src/b.ts", "new.ts", "has space.ts"]
        );
        assert!(parse_porcelain_status("").is_empty());
    }

    #[test]
    fn picks_local_branch_name() {
        assert_eq!(local_branch_for_pr(12, "feat/x", false), "feat/x");
        assert_eq!(local_branch_for_pr(12, "main", true), "pr/12");
    }

    #[test]
    fn validates_branch_names() {
        for ok in ["feat/x", "fix-1", "release/v1.2.3", "user/topic_name"] {
            assert!(is_safe_branch_name(ok), "{ok} should be accepted");
        }
        for bad in [
            "", "-x", "--force", "a..b", "a b", "a~1", "a^", "a:b", "x.lock", "x/", "/x", "a@{1}",
            "a\nb", "a//b",
        ] {
            assert!(!is_safe_branch_name(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn matches_origin_owner_repo() {
        assert!(remote_matches_owner_repo(
            "git@github.com:Acme/Widgets.git",
            "acme/widgets"
        ));
        assert!(remote_matches_owner_repo(
            "https://github.com/acme/widgets",
            "acme/widgets"
        ));
        assert!(!remote_matches_owner_repo(
            "https://github.com/acme/other",
            "acme/widgets"
        ));
        assert!(!remote_matches_owner_repo(
            "/local/path/origin.git",
            "acme/widgets"
        ));
    }

    struct Fixture {
        root: PathBuf,
        seed: String,
        work: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn git_in(dir: &str, args: &[&str]) -> String {
        run_git(dir, args).unwrap_or_else(|e| panic!("git {args:?} in {dir}: {e}"))
    }

    fn commit_file(dir: &str, file: &str, content: &str, msg: &str) -> String {
        std::fs::write(Path::new(dir).join(file), content).unwrap();
        git_in(dir, &["add", file]);
        git_in(dir, &["commit", "-q", "-m", msg]);
        git_in(dir, &["rev-parse", "HEAD"])
    }

    fn configure_identity(dir: &str) {
        git_in(dir, &["config", "user.email", "test@example.com"]);
        git_in(dir, &["config", "user.name", "Test"]);
        git_in(dir, &["config", "commit.gpgsign", "false"]);
    }

    /// origin (bare) with `main`, `feat/x`, and a fork PR at `refs/pull/7/head`;
    /// `work` is a clone of origin sitting on `main`.
    fn fixture() -> Fixture {
        let root = std::env::temp_dir().join(format!(
            "stroll_checkout_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let root_s = root.to_string_lossy().to_string();
        let origin = root.join("origin.git").to_string_lossy().to_string();
        let seed = root.join("seed").to_string_lossy().to_string();
        let work = root.join("work").to_string_lossy().to_string();

        git_in(&root_s, &["init", "-q", "--bare", "-b", "main", &origin]);
        git_in(&root_s, &["init", "-q", "-b", "main", &seed]);
        configure_identity(&seed);
        git_in(&seed, &["remote", "add", "origin", &origin]);
        commit_file(&seed, "a.txt", "base\n", "base");
        git_in(&seed, &["push", "-q", "origin", "main"]);

        git_in(&seed, &["switch", "-q", "-c", "feat/x"]);
        commit_file(&seed, "a.txt", "feature\n", "feature");
        git_in(&seed, &["push", "-q", "origin", "feat/x"]);

        git_in(&seed, &["switch", "-q", "-c", "fork-main", "main"]);
        let fork_oid = commit_file(&seed, "b.txt", "fork\n", "fork change");
        git_in(
            &seed,
            &[
                "push",
                "-q",
                "origin",
                &format!("{fork_oid}:refs/pull/7/head"),
            ],
        );

        git_in(&root_s, &["clone", "-q", &origin, &work]);
        configure_identity(&work);

        Fixture { root, seed, work }
    }

    fn request(work: &str, number: u64, head: &str, cross: bool) -> GitCheckoutPrRequest {
        GitCheckoutPrRequest {
            repo_path: work.to_string(),
            expected_owner_repo: "acme/widgets".to_string(),
            number,
            head_ref_name: head.to_string(),
            is_cross_repository: cross,
        }
    }

    #[test]
    fn checks_out_same_repo_branch_and_fast_forwards() {
        let fx = fixture();
        let feat_oid = git_in(&fx.seed, &["rev-parse", "feat/x"]);

        let res = checkout_pr_unverified(&request(&fx.work, 3, "feat/x", false)).unwrap();
        assert_eq!(res.branch, "feat/x");
        assert_eq!(res.head_oid, feat_oid);
        assert!(res.created);
        let upstream = git_in(
            &fx.work,
            &["rev-parse", "--abbrev-ref", "feat/x@{upstream}"],
        );
        assert_eq!(upstream, "origin/feat/x");

        // Re-running is a no-op.
        let again = checkout_pr_unverified(&request(&fx.work, 3, "feat/x", false)).unwrap();
        assert!(!again.created && !again.fast_forwarded && !again.local_ahead);

        // New commit on the PR while the reviewer is on main → fast-forward + switch.
        git_in(&fx.seed, &["switch", "-q", "feat/x"]);
        let new_oid = commit_file(&fx.seed, "a.txt", "feature v2\n", "more");
        git_in(&fx.seed, &["push", "-q", "origin", "feat/x"]);
        git_in(&fx.work, &["switch", "-q", "main"]);

        let ff = checkout_pr_unverified(&request(&fx.work, 3, "feat/x", false)).unwrap();
        assert!(ff.fast_forwarded);
        assert_eq!(ff.head_oid, new_oid);
        assert_eq!(
            local_status(&fx.work).unwrap().branch.as_deref(),
            Some("feat/x")
        );

        // Local-only commit on top → left alone, reported as ahead.
        let local_oid = commit_file(&fx.work, "c.txt", "mine\n", "local");
        let ahead = checkout_pr_unverified(&request(&fx.work, 3, "feat/x", false)).unwrap();
        assert!(ahead.local_ahead);
        assert_eq!(ahead.head_oid, local_oid);
    }

    #[test]
    fn checks_out_fork_pr_into_pr_branch() {
        let fx = fixture();
        let fork_oid = git_in(&fx.seed, &["rev-parse", "fork-main"]);

        let res = checkout_pr_unverified(&request(&fx.work, 7, "main", true)).unwrap();
        assert_eq!(res.branch, "pr/7");
        assert_eq!(res.head_oid, fork_oid);
        assert!(res.created);
        // The reviewer's own main is untouched.
        assert_ne!(git_in(&fx.work, &["rev-parse", "main"]), fork_oid);
    }

    #[test]
    fn refuses_diverged_local_branch() {
        let fx = fixture();
        git_in(&fx.work, &["switch", "-q", "-c", "pr/7", "main"]);
        commit_file(&fx.work, "z.txt", "unrelated\n", "unrelated");
        git_in(&fx.work, &["switch", "-q", "main"]);

        let err = checkout_pr_unverified(&request(&fx.work, 7, "main", true)).unwrap_err();
        assert!(err.contains("diverged"), "{err}");
        assert_eq!(
            local_status(&fx.work).unwrap().branch.as_deref(),
            Some("main")
        );
    }

    #[test]
    fn blocks_on_uncommitted_changes() {
        let fx = fixture();
        std::fs::write(Path::new(&fx.work).join("a.txt"), "edited\n").unwrap();
        // Untracked files alone do not block.
        std::fs::write(Path::new(&fx.work).join("scratch.txt"), "x\n").unwrap();

        let status = local_status(&fx.work).unwrap();
        assert_eq!(status.dirty_files, vec!["a.txt"]);

        let err = checkout_pr_unverified(&request(&fx.work, 3, "feat/x", false)).unwrap_err();
        assert!(
            err.contains("uncommitted changes") && err.contains("a.txt"),
            "{err}"
        );
        assert_eq!(status.branch.as_deref(), Some("main"));
    }

    #[test]
    fn rejects_bad_input_and_wrong_origin() {
        let fx = fixture();
        let err =
            checkout_pr_unverified(&request(&fx.work, 3, "--upload-pack=x", false)).unwrap_err();
        assert!(err.contains("unusual branch name"), "{err}");

        // Local-path origin cannot be matched to owner/repo.
        let err = checkout_pr(&request(&fx.work, 3, "feat/x", false)).unwrap_err();
        assert!(err.contains("is not acme/widgets"), "{err}");

        git_in(
            &fx.work,
            &[
                "remote",
                "set-url",
                "origin",
                "git@github.com:acme/widgets.git",
            ],
        );
        assert!(verify_origin(&fx.work, "Acme/Widgets").is_ok());
    }
}
