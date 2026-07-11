use super::config::ProviderKind;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

/// Plain-file secret storage under `~/.meetly/secrets.json` instead of the
/// macOS Keychain. Trade-off (deliberate, at the user's request): every
/// `cargo tauri dev` run produces a differently-signed debug binary, so
/// Keychain treats each run as a new, unverified requester and re-prompts
/// "meetly wants to use..." on every single launch during development.
/// Storing the key in a plain file avoids that friction entirely, at the
/// cost of no longer being encrypted at rest — anything with read access to
/// this user account can read the key. Not suitable for anything beyond
/// local single-user development. If this project ships a signed release
/// build, moving back to Keychain (or Stronghold) is worth revisiting since
/// a consistently-signed app is only prompted once, not on every run.
///
/// File is created with `0600` permissions (owner read/write only) as a
/// minimal mitigation.
fn secrets_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Failed to resolve home directory")?;
    Ok(home.join(".meetly"))
}

fn secrets_path() -> Result<PathBuf> {
    Ok(secrets_dir()?.join("secrets.json"))
}

fn account_for(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Stt => "stt_api_key",
        ProviderKind::Llm => "llm_api_key",
    }
}

const EXA_API_KEY_ACCOUNT: &str = "exa_api_key";

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredSecrets {
    #[serde(flatten)]
    entries: HashMap<String, String>,
}

fn read_all() -> Result<StoredSecrets> {
    let path = secrets_path()?;
    if !path.exists() {
        return Ok(StoredSecrets::default());
    }

    let bytes =
        std::fs::read(&path).with_context(|| format!("Failed to read {}", path.display()))?;
    let parsed = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    Ok(parsed)
}

fn write_all(secrets: &StoredSecrets) -> Result<()> {
    let dir = secrets_dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("Failed to create {}", dir.display()))?;

    let path = secrets_path()?;
    let bytes = serde_json::to_vec_pretty(secrets).context("Failed to serialize secrets")?;

    // Write then chmod, rather than relying on a default umask, so the file
    // is never briefly world-readable.
    let mut file = std::fs::File::create(&path)
        .with_context(|| format!("Failed to create {}", path.display()))?;
    file.write_all(&bytes)
        .with_context(|| format!("Failed to write {}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, permissions)
            .with_context(|| format!("Failed to set permissions on {}", path.display()))?;
    }

    Ok(())
}

/// Writes an API key to `~/.meetly/secrets.json`. Overwrites any previously
/// stored key for the same provider kind. Never logs or returns the key
/// value.
pub fn set_api_key(kind: ProviderKind, api_key: &str) -> Result<()> {
    let mut secrets = read_all()?;
    secrets
        .entries
        .insert(account_for(kind).to_string(), api_key.to_string());
    write_all(&secrets)
}

/// Reads the API key for `kind`. Returns `Ok(None)` if no key has been
/// saved yet (distinct from an error).
pub fn get_api_key(kind: ProviderKind) -> Result<Option<String>> {
    let secrets = read_all()?;
    Ok(secrets.entries.get(account_for(kind)).cloned())
}

/// Returns whether an API key is currently saved for `kind`, without
/// exposing the key value.
pub fn has_api_key(kind: ProviderKind) -> Result<bool> {
    Ok(get_api_key(kind)?.is_some())
}

pub fn set_exa_api_key(api_key: &str) -> Result<()> {
    let mut secrets = read_all()?;
    secrets
        .entries
        .insert(EXA_API_KEY_ACCOUNT.to_string(), api_key.to_string());
    write_all(&secrets)
}

pub fn get_exa_api_key() -> Result<Option<String>> {
    let secrets = read_all()?;
    Ok(secrets.entries.get(EXA_API_KEY_ACCOUNT).cloned())
}
