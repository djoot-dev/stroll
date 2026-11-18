use serde::{Deserialize, Serialize};
use std::process::Command;

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

/// Reads multiple `<oid>:<path>` blobs from a local git checkout using `git show`.
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

    let results = request
        .specs
        .iter()
        .map(|spec| {
            let obj = format!("{}:{}", spec.oid.trim(), spec.path);
            let output = Command::new("git")
                .arg("-C")
                .arg(&request.repo_path)
                .arg("show")
                .arg(&obj)
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            String::from_utf8(output.stdout).ok()
        })
        .collect();

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

    let mut cmd = Command::new("git");
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
}
