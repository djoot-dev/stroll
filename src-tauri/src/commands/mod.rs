pub mod ast;
pub mod gh;
pub mod git;

use serde::Serialize;

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
