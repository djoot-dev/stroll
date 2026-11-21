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

    let line_num = line.max(1);
    let normalized_path = target.to_string_lossy().replace('\\', "/");
    let url = if normalized_path.starts_with('/') {
        format!("{scheme}://file{normalized_path}:{line_num}:1")
    } else {
        format!("{scheme}://file/{normalized_path}:{line_num}:1")
    };

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
