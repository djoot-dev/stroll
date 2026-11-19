use keyring::{Entry, Error as KeyringError};

const KEYCHAIN_SERVICE: &str = "com.stroll.desktop";
const KEYCHAIN_ACCOUNT: &str = "github_pat";

fn github_pat_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to initialize OS keychain entry: {e}"))
}

#[tauri::command]
pub fn save_github_token(token: String) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return delete_github_token();
    }
    let entry = github_pat_entry()?;
    entry
        .set_password(trimmed)
        .map_err(|e| format!("Failed to save GitHub token to OS keychain: {e}"))
}

#[tauri::command]
pub fn load_github_token() -> Result<Option<String>, String> {
    let entry = github_pat_entry()?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to load GitHub token from OS keychain: {e}")),
    }
}

#[tauri::command]
pub fn delete_github_token() -> Result<(), String> {
    let entry = github_pat_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete GitHub token from OS keychain: {e}")),
    }
}
