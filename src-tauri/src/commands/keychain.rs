use keyring::{Entry, Error as KeyringError};
use std::sync::{Mutex, OnceLock};

const KEYCHAIN_SERVICE: &str = "com.stroll.desktop";
const KEYCHAIN_ACCOUNT: &str = "github_pat";

/// Cached keychain state for the current process:
/// - `None`: not yet read/written in this session
/// - `Some(None)`: known absent in OS keychain
/// - `Some(Some(token))`: known token value in OS keychain
type CachedTokenState = Option<Option<String>>;

static TOKEN_CACHE: OnceLock<Mutex<CachedTokenState>> = OnceLock::new();

fn token_cache() -> &'static Mutex<CachedTokenState> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn github_pat_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to initialize OS keychain entry: {e}"))
}

fn save_github_token_with(
    cache_mutex: &Mutex<CachedTokenState>,
    token: String,
    write_fn: impl FnOnce(&str) -> Result<(), String>,
    delete_fn: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return delete_github_token_with(cache_mutex, delete_fn);
    }

    let mut cache = cache_mutex.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(&*cache, Some(Some(existing)) if existing == trimmed) {
        return Ok(());
    }

    write_fn(trimmed)?;
    *cache = Some(Some(trimmed.to_string()));
    Ok(())
}

fn load_github_token_with(
    cache_mutex: &Mutex<CachedTokenState>,
    read_fn: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    let mut cache = cache_mutex.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(cached) = &*cache {
        return Ok(cached.clone());
    }

    let loaded = read_fn()?;
    *cache = Some(loaded.clone());
    Ok(loaded)
}

fn delete_github_token_with(
    cache_mutex: &Mutex<CachedTokenState>,
    delete_fn: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut cache = cache_mutex.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(&*cache, Some(None)) {
        return Ok(());
    }

    delete_fn()?;
    *cache = Some(None);
    Ok(())
}

#[tauri::command]
pub fn save_github_token(token: String) -> Result<(), String> {
    save_github_token_with(
        token_cache(),
        token,
        |trimmed| {
            let entry = github_pat_entry()?;
            entry
                .set_password(trimmed)
                .map_err(|e| format!("Failed to save GitHub token to OS keychain: {e}"))
        },
        || {
            let entry = github_pat_entry()?;
            match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
                Err(e) => Err(format!("Failed to delete GitHub token from OS keychain: {e}")),
            }
        },
    )
}

#[tauri::command]
pub fn load_github_token() -> Result<Option<String>, String> {
    load_github_token_with(token_cache(), || {
        let entry = github_pat_entry()?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(e) => Err(format!("Failed to load GitHub token from OS keychain: {e}")),
        }
    })
}

#[tauri::command]
pub fn delete_github_token() -> Result<(), String> {
    delete_github_token_with(token_cache(), || {
        let entry = github_pat_entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete GitHub token from OS keychain: {e}")),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn load_caches_token_and_avoids_repeated_keychain_reads() {
        let cache = Mutex::new(None);
        let reads = AtomicUsize::new(0);

        let first = load_github_token_with(&cache, || {
            reads.fetch_add(1, Ordering::SeqCst);
            Ok(Some("ghp_abc123".to_string()))
        })
        .unwrap();
        let second = load_github_token_with(&cache, || {
            reads.fetch_add(1, Ordering::SeqCst);
            Ok(Some("ghp_should_not_read".to_string()))
        })
        .unwrap();

        assert_eq!(first.as_deref(), Some("ghp_abc123"));
        assert_eq!(second.as_deref(), Some("ghp_abc123"));
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn save_skips_keychain_write_when_token_matches_cache() {
        let cache = Mutex::new(None);
        let writes = AtomicUsize::new(0);

        load_github_token_with(&cache, || Ok(Some("ghp_same".to_string()))).unwrap();

        save_github_token_with(
            &cache,
            "  ghp_same  ".to_string(),
            |_| {
                writes.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();

        assert_eq!(writes.load(Ordering::SeqCst), 0);

        save_github_token_with(
            &cache,
            "ghp_updated".to_string(),
            |val| {
                assert_eq!(val, "ghp_updated");
                writes.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();

        assert_eq!(writes.load(Ordering::SeqCst), 1);
        let loaded = load_github_token_with(&cache, || unreachable!("should hit cache")).unwrap();
        assert_eq!(loaded.as_deref(), Some("ghp_updated"));
    }

    #[test]
    fn delete_updates_cache_and_skips_when_already_absent() {
        let cache = Mutex::new(None);
        let deletes = AtomicUsize::new(0);

        load_github_token_with(&cache, || Ok(None)).unwrap();

        delete_github_token_with(&cache, || {
            deletes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert_eq!(deletes.load(Ordering::SeqCst), 0);

        save_github_token_with(&cache, "ghp_temp".to_string(), |_| Ok(()), || Ok(())).unwrap();
        delete_github_token_with(&cache, || {
            deletes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert_eq!(deletes.load(Ordering::SeqCst), 1);

        let loaded = load_github_token_with(&cache, || unreachable!("should hit cache")).unwrap();
        assert_eq!(loaded, None);
    }

    #[test]
    fn errors_are_not_cached() {
        let cache = Mutex::new(None);
        let err = load_github_token_with(&cache, || Err("user cancelled".to_string())).unwrap_err();
        assert_eq!(err, "user cancelled");

        let ok = load_github_token_with(&cache, || Ok(Some("ghp_retry".to_string()))).unwrap();
        assert_eq!(ok.as_deref(), Some("ghp_retry"));
    }
}
