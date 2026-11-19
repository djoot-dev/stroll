use std::io::ErrorKind;
use std::path::Path;

use super::hidden_command;

const GH_FALLBACK_PATHS: &[&str] = &[
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/usr/bin/gh",
];

fn run_gh_auth_token(bin: &str) -> std::io::Result<std::process::Output> {
    hidden_command(bin).args(["auth", "token"]).output()
}

/// Reads the active GitHub CLI (`gh`) auth token from the user's local `gh` session.
#[tauri::command]
pub fn get_gh_auth_token() -> Result<String, String> {
    let output = match run_gh_auth_token("gh") {
        Ok(out) => out,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let mut found_output = None;
            for candidate in GH_FALLBACK_PATHS {
                if Path::new(candidate).is_file() {
                    if let Ok(out) = run_gh_auth_token(candidate) {
                        found_output = Some(out);
                        break;
                    }
                }
            }
            match found_output {
                Some(out) => out,
                None => {
                    return Err(
                        "GitHub CLI (gh) was not found. Install it or paste a Personal Access Token."
                            .to_string(),
                    )
                }
            }
        }
        Err(err) => return Err(format!("Failed to run gh CLI: {err}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            "Run `gh auth login` in your terminal first.".to_string()
        } else {
            stderr
        };
        return Err(format!("GitHub CLI is not authenticated: {detail}"));
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("GitHub CLI returned an empty token. Run `gh auth login`.".to_string());
    }

    Ok(token)
}
