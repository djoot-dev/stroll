pub mod ast;
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
