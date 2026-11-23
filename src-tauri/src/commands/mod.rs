pub mod ast;
pub mod checkout;
pub mod csharp_index;
pub mod gh;
pub mod git;
pub mod keychain;

use serde::Serialize;

/// Creates a `Command` that suppresses console window popups on Windows.
pub(crate) fn hidden_command(program: &str) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = std::process::Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(program)
    }
}

#[derive(Debug, Serialize)]
pub struct RuntimeInfo {
    pub app_version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub git_supported: bool,
    pub ast_supported: bool,
}

/// Returns basic runtime capabilities.
#[tauri::command]
pub fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        git_supported: true,
        ast_supported: true,
    }
}

fn percent_encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn is_windows_drive(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub fn build_editor_url(scheme: &str, raw_path: &str, line: u32) -> String {
    let stripped = if let Some(rest) = raw_path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw_path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw_path.to_string()
    };

    let normalized = stripped.replace('\\', "/");
    let encoded_segments: Vec<String> = normalized
        .split('/')
        .enumerate()
        .map(|(idx, seg)| {
            if seg.is_empty() || (idx == 0 && is_windows_drive(seg)) {
                seg.to_string()
            } else {
                percent_encode_segment(seg)
            }
        })
        .collect();
    let encoded_path = encoded_segments.join("/");
    let line_num = line.max(1);
    if encoded_path.starts_with('/') {
        format!("{scheme}://file{encoded_path}:{line_num}:1")
    } else {
        format!("{scheme}://file/{encoded_path}:{line_num}:1")
    }
}

/// Opens a file at a 1-based line number in the user's configured local editor.
#[tauri::command]
pub fn open_in_local_editor(
    repo_path: String,
    file_path: String,
    line: u32,
    editor: String,
) -> Result<(), String> {
    let base = std::path::Path::new(&repo_path);
    if !base.is_dir() {
        return Err("Linked repository path does not exist.".to_string());
    }

    let rel = std::path::Path::new(&file_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Invalid repository-relative file path.".to_string());
    }

    let full = base.join(rel);
    let canonical_base = base
        .canonicalize()
        .map_err(|e| format!("Failed to resolve repository path: {e}"))?;
    let target = if full.exists() {
        let canonical_full = full
            .canonicalize()
            .map_err(|e| format!("Failed to resolve file path: {e}"))?;
        if !canonical_full.starts_with(&canonical_base) {
            return Err("File path escapes the linked repository.".to_string());
        }
        canonical_full
    } else {
        full
    };

    let scheme = match editor.as_str() {
        "cursor" => "cursor",
        "zed" => "zed",
        _ => "vscode",
    };

    let url = build_editor_url(scheme, &target.to_string_lossy(), line);

    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = hidden_command("cmd");
        c.args(["/C", "start", ""]);
        c
    };

    cmd.arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to launch editor ({scheme}): {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::build_editor_url;

    #[test]
    fn builds_unix_editor_url_and_encodes_spaces() {
        assert_eq!(
            build_editor_url("vscode", "/Users/dev/my repo/src/file #1.ts", 42),
            "vscode://file/Users/dev/my%20repo/src/file%20%231.ts:42:1"
        );
    }

    #[test]
    fn strips_windows_verbatim_prefix_and_preserves_drive_letter() {
        assert_eq!(
            build_editor_url("vscode", r"\\?\C:\Users\dev\my repo\src\app.ts", 12),
            "vscode://file/C:/Users/dev/my%20repo/src/app.ts:12:1"
        );
    }

    #[test]
    fn clamps_zero_line_to_one() {
        assert_eq!(
            build_editor_url("cursor", "/repo/main.rs", 0),
            "cursor://file/repo/main.rs:1:1"
        );
    }
}
