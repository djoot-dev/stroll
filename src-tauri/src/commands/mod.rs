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
/// Future Phase 2 modules (`git`, `tree_sitter`) will register commands here
/// and flip `git_supported` / `ast_supported` to true.
#[tauri::command]
pub fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        git_supported: false,
        ast_supported: false,
    }
}
