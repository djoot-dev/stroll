pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_info,
            commands::ast::resolve_repo_symbol,
            commands::gh::get_gh_auth_token,
            commands::git::git_blame_line,
            commands::git::git_read_blobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PR Tour Tauri application");
}
