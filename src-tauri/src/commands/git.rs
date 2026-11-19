use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::process::Stdio;

use super::hidden_command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLineRequest {
    pub repo_path: String,
    pub file_path: String,
    pub line: usize,
    pub ref_oid: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameInfo {
    pub commit_oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlobSpec {
    pub oid: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReadBlobsRequest {
    pub repo_path: String,
    pub specs: Vec<GitBlobSpec>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepoInspection {
    pub is_git_repo: bool,
    pub owner_repo: Option<String>,
}

/// Parses a git remote URL (SSH or HTTPS) into `owner/repo`.
///
/// Supports:
/// - `git@github.com:owner/repo.git`
/// - `git@ghe.company.com:owner/repo`
/// - `ssh://git@github.com/owner/repo.git`
/// - `ssh://git@github.com:22/owner/repo.git`
/// - `https://github.com/owner/repo.git`
/// - `https://user@ghe.company.com/owner/repo`
pub fn parse_remote_owner_repo(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path_part = if let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
    {
        // Strip authority (user@host:port) up to first '/'
        let slash_idx = rest.find('/')?;
        &rest[slash_idx + 1..]
    } else if let Some(colon_idx) = trimmed.find(':') {
        // SCP-like SSH syntax: git@host:owner/repo.git
        let prefix = &trimmed[..colon_idx];
        if prefix.contains('/') || prefix.is_empty() {
            return None;
        }
        &trimmed[colon_idx + 1..]
    } else {
        return None;
    };

    let cleaned = path_part.trim_matches('/');
    let cleaned = cleaned.strip_suffix(".git").unwrap_or(cleaned);
    let cleaned = cleaned.trim_matches('/');

    let mut segments = cleaned.split('/').filter(|s| !s.is_empty());
    let owner = segments.next()?;
    let repo = segments.next()?;
    if segments.next().is_some() {
        return None;
    }

    Some(format!("{owner}/{repo}"))
}

/// Checks whether `path` is inside a git work tree and attempts to detect `owner/repo`
/// from the `origin` remote URL.
#[tauri::command]
pub fn inspect_local_repo(path: String) -> Result<LocalRepoInspection, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(LocalRepoInspection {
            is_git_repo: false,
            owner_repo: None,
        });
    }

    let dir = std::path::Path::new(trimmed);
    if !dir.is_dir() {
        return Ok(LocalRepoInspection {
            is_git_repo: false,
            owner_repo: None,
        });
    }

    let rev_parse = hidden_command("git")
        .arg("-C")
        .arg(trimmed)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output();

    let is_git_repo = match rev_parse {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim() == "true"
        }
        _ => false,
    };

    if !is_git_repo {
        return Ok(LocalRepoInspection {
            is_git_repo: false,
            owner_repo: None,
        });
    }

    let owner_repo = hidden_command("git")
        .arg("-C")
        .arg(trimmed)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_remote_owner_repo(&stdout)
        });

    Ok(LocalRepoInspection {
        is_git_repo: true,
        owner_repo,
    })
}

fn parse_cat_file_header(line: &[u8]) -> Option<(&str, usize)> {
    let text = std::str::from_utf8(line)
        .ok()?
        .trim_end_matches(&['\r', '\n'][..]);
    let mut parts = text.split(' ');
    let oid = parts.next()?;
    let obj_type = parts.next()?;
    let size_str = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if oid.len() < 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    if !matches!(obj_type, "blob" | "tree" | "commit" | "tag") {
        return None;
    }
    let size = size_str.parse::<usize>().ok()?;
    Some((obj_type, size))
}

/// Reads multiple `<oid>:<path>` blobs from a local git checkout using a single
/// `git cat-file --batch` process.
/// Returns `None` for any blob that is missing locally (e.g. un-fetched commit).
#[tauri::command]
pub fn git_read_blobs(request: GitReadBlobsRequest) -> Result<Vec<Option<String>>, String> {
    let repo_dir = std::path::Path::new(&request.repo_path);
    if !repo_dir.is_dir() {
        return Err(format!(
            "Repository path does not exist or is not a directory: {}",
            request.repo_path
        ));
    }

    let mut results = vec![None; request.specs.len()];
    if request.specs.is_empty() {
        return Ok(results);
    }

    let valid_indices: Vec<usize> = request
        .specs
        .iter()
        .enumerate()
        .filter_map(|(idx, spec)| {
            let oid = spec.oid.trim();
            if oid.is_empty()
                || oid.contains(['\n', '\r'])
                || spec.path.contains(['\n', '\r'])
            {
                None
            } else {
                Some(idx)
            }
        })
        .collect();

    if valid_indices.is_empty() {
        return Ok(results);
    }

    let mut child = match hidden_command("git")
        .arg("-C")
        .arg(&request.repo_path)
        .arg("cat-file")
        .arg("--batch")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Ok(results),
    };

    let Some(stdin) = child.stdin.take() else {
        let _ = child.wait();
        return Ok(results);
    };
    let Some(stdout) = child.stdout.take() else {
        drop(stdin);
        let _ = child.wait();
        return Ok(results);
    };

    std::thread::scope(|s| {
        let specs = &request.specs;
        let valid = &valid_indices;
        s.spawn(move || {
            let mut writer = BufWriter::new(stdin);
            for &idx in valid {
                let spec = &specs[idx];
                if writeln!(writer, "{}:{}", spec.oid.trim(), spec.path).is_err() {
                    break;
                }
            }
            let _ = writer.flush();
        });

        let mut reader = BufReader::new(stdout);
        let mut header_buf = Vec::new();
        let mut body_buf = Vec::new();

        for &idx in &valid_indices {
            header_buf.clear();
            let read_len = match reader.read_until(b'\n', &mut header_buf) {
                Ok(n) => n,
                Err(_) => break,
            };
            if read_len == 0 {
                break;
            }

            if let Some((obj_type, size)) = parse_cat_file_header(&header_buf) {
                body_buf.resize(size, 0);
                if reader.read_exact(&mut body_buf).is_err() {
                    break;
                }
                let mut trailing_nl = [0u8; 1];
                if reader.read_exact(&mut trailing_nl).is_err() {
                    break;
                }
                if obj_type == "blob" {
                    results[idx] = std::str::from_utf8(&body_buf).ok().map(str::to_owned);
                }
            }
        }
    });

    let _ = child.wait();
    Ok(results)
}

/// Parses `git blame --porcelain -L <line>,<line>` stdout into `GitBlameInfo`.
pub fn parse_porcelain_blame(stdout: &str) -> Result<GitBlameInfo, String> {
    let mut lines = stdout.lines();
    let header = lines
        .next()
        .ok_or_else(|| "Empty git blame output".to_string())?;
    let commit_oid = header
        .split_whitespace()
        .next()
        .ok_or_else(|| "Missing commit OID in git blame output".to_string())?
        .to_string();

    if commit_oid.len() < 7 {
        return Err(format!("Unexpected commit OID in git blame: {commit_oid}"));
    }

    let short_oid = commit_oid[..7].to_string();
    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut timestamp: i64 = 0;
    let mut summary = String::new();

    for line in lines {
        if let Some(rest) = line.strip_prefix("author ") {
            author_name = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("author-mail ") {
            author_email = rest
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
        } else if let Some(rest) = line.strip_prefix("author-time ") {
            timestamp = rest.trim().parse::<i64>().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("summary ") {
            summary = rest.trim().to_string();
        }
    }

    Ok(GitBlameInfo {
        commit_oid,
        short_oid,
        author_name,
        author_email,
        timestamp,
        summary,
    })
}

/// Runs `git blame --porcelain -L <line>,<line> [<refOid>] -- <filePath>` in `repoPath`.
#[tauri::command]
pub fn git_blame_line(request: GitBlameLineRequest) -> Result<GitBlameInfo, String> {
    if request.line == 0 {
        return Err("Line number must be >= 1".to_string());
    }

    let repo_dir = std::path::Path::new(&request.repo_path);
    if !repo_dir.is_dir() {
        return Err(format!(
            "Repository path does not exist or is not a directory: {}",
            request.repo_path
        ));
    }

    let mut cmd = hidden_command("git");
    cmd.arg("-C")
        .arg(&request.repo_path)
        .arg("blame")
        .arg("--porcelain")
        .arg("-L")
        .arg(format!("{},{}", request.line, request.line));

    if let Some(ref oid) = request.ref_oid {
        let trimmed = oid.trim();
        if !trimmed.is_empty() {
            cmd.arg(trimmed);
        }
    }

    cmd.arg("--").arg(&request.file_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute git blame: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git blame failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_porcelain_blame(&stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_blame_output() {
        let sample = "\
a1b2c3d4e5f6789012345678901234567890abcd 12 12 1
author Jane Doe
author-mail <jane@example.com>
author-time 1700000000
author-tz +0000
committer Jane Doe
committer-mail <jane@example.com>
committer-time 1700000000
committer-tz +0000
summary feat: add webhook retry policy
filename src/services/webhookDispatcher.ts
\tconst maxRetries = 3;
";
        let info = parse_porcelain_blame(sample).expect("should parse porcelain output");
        assert_eq!(
            info,
            GitBlameInfo {
                commit_oid: "a1b2c3d4e5f6789012345678901234567890abcd".to_string(),
                short_oid: "a1b2c3d".to_string(),
                author_name: "Jane Doe".to_string(),
                author_email: "jane@example.com".to_string(),
                timestamp: 1700000000,
                summary: "feat: add webhook retry policy".to_string(),
            }
        );
    }

    #[test]
    fn parses_ssh_and_https_remote_urls() {
        assert_eq!(
            parse_remote_owner_repo("git@github.com:acme/stroll.git"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("git@github.com:acme/stroll"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("git@github.enterprise.local:platform-team/core-api.git\n"),
            Some("platform-team/core-api".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("ssh://git@github.com/acme/stroll.git"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("ssh://git@ghe.internal:2222/acme/stroll.git"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("https://github.com/acme/stroll.git"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("https://github.com/acme/stroll/"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("https://octocat@ghe.company.com/acme/stroll.git"),
            Some("acme/stroll".to_string())
        );
        assert_eq!(
            parse_remote_owner_repo("http://github.local/acme/stroll"),
            Some("acme/stroll".to_string())
        );
    }

    #[test]
    fn rejects_invalid_remote_urls() {
        assert_eq!(parse_remote_owner_repo(""), None);
        assert_eq!(parse_remote_owner_repo("   "), None);
        assert_eq!(parse_remote_owner_repo("/local/path/to/repo"), None);
        assert_eq!(parse_remote_owner_repo("https://github.com/only-owner"), None);
        assert_eq!(
            parse_remote_owner_repo("https://github.com/acme/stroll/extra"),
            None
        );
    }

    #[test]
    fn parses_cat_file_batch_headers() {
        let oid = "a1b2c3d4e5f6789012345678901234567890abcd";
        assert_eq!(
            parse_cat_file_header(format!("{oid} blob 42\n").as_bytes()),
            Some(("blob", 42))
        );
        assert_eq!(
            parse_cat_file_header(format!("{oid} tree 0\n").as_bytes()),
            Some(("tree", 0))
        );
        assert_eq!(
            parse_cat_file_header(format!("{oid}:missing.txt missing\n").as_bytes()),
            None
        );
        assert_eq!(
            parse_cat_file_header(format!("{oid}:file missing missing\n").as_bytes()),
            None
        );
    }

    #[test]
    fn reads_blobs_in_single_batch() {
        let temp_dir = std::env::temp_dir().join(format!(
            "stroll_git_batch_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let run_git = |args: &[&str]| {
            let out = hidden_command("git")
                .arg("-C")
                .arg(&temp_dir)
                .args(args)
                .output()
                .expect("git should run");
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };

        run_git(&["init"]);
        run_git(&["config", "user.email", "test@example.com"]);
        run_git(&["config", "user.name", "Test"]);

        std::fs::write(temp_dir.join("a.txt"), "hello\nworld\n").unwrap();
        std::fs::write(temp_dir.join("bin.dat"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
        std::fs::write(temp_dir.join("b.txt"), "second file").unwrap();

        run_git(&["add", "."]);
        run_git(&["commit", "-m", "initial"]);
        let head = run_git(&["rev-parse", "HEAD"]);

        let repo_path = temp_dir.to_string_lossy().to_string();

        // Empty specs returns empty vec
        let empty = git_read_blobs(GitReadBlobsRequest {
            repo_path: repo_path.clone(),
            specs: vec![],
        })
        .unwrap();
        assert!(empty.is_empty());

        // Interleave existing, missing, binary, and newline-invalid specs
        let blobs = git_read_blobs(GitReadBlobsRequest {
            repo_path,
            specs: vec![
                GitBlobSpec {
                    oid: head.clone(),
                    path: "a.txt".to_string(),
                },
                GitBlobSpec {
                    oid: head.clone(),
                    path: "does-not-exist.txt".to_string(),
                },
                GitBlobSpec {
                    oid: head.clone(),
                    path: "bin.dat".to_string(),
                },
                GitBlobSpec {
                    oid: head.clone(),
                    path: "bad\npath.txt".to_string(),
                },
                GitBlobSpec {
                    oid: head,
                    path: "b.txt".to_string(),
                },
            ],
        })
        .unwrap();

        assert_eq!(
            blobs,
            vec![
                Some("hello\nworld\n".to_string()),
                None,
                None,
                None,
                Some("second file".to_string()),
            ]
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
