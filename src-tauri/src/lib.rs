pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_info,
            commands::ast::resolve_repo_symbol,
            commands::checkout::git_checkout_pr,
            commands::checkout::git_local_status,
            commands::csharp_index::index_csharp_types,
            commands::gh::get_gh_auth_token,
            commands::git::git_blame_line,
            commands::git::git_read_blobs,
            commands::git::inspect_local_repo,
            commands::keychain::save_github_token,
            commands::keychain::load_github_token,
            commands::keychain::delete_github_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stroll Tauri application");
}
