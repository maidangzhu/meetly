use serde_json::Value;
use std::fs::{create_dir_all, metadata, remove_file, rename, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_ENTRY_BYTES: usize = 8 * 1024;
const MAX_STRING_CHARS: usize = 512;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
pub fn append_coach_event_log(mut entry: Value) -> Result<(), String> {
    validate_entry(&entry)?;
    sanitize_value(&mut entry, None);
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    if line.len() > MAX_ENTRY_BYTES {
        return Err("Coach event log entry is too large.".to_string());
    }
    append_line(&coach_log_path()?, &line, MAX_FILE_BYTES)
}
fn validate_entry(entry: &Value) -> Result<(), String> {
    let object = entry
        .as_object()
        .ok_or_else(|| "Coach event log entry must be an object.".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported Coach event log schema version.".to_string());
    }
    match object.get("recordType").and_then(Value::as_str) {
        Some("event" | "transition") => {}
        _ => return Err("Invalid Coach event log record type.".to_string()),
    }
    let session_id = object
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Coach event log session id is required.".to_string())?;
    if session_id.is_empty() || session_id.len() > 120 {
        return Err("Invalid Coach event log session id.".to_string());
    }
    if object.get("recordedAtMs").and_then(Value::as_u64).is_none() {
        return Err("Coach event log timestamp is required.".to_string());
    }
    Ok(())
}

fn sanitize_value(value: &mut Value, key: Option<&str>) {
    if key.is_some_and(is_sensitive_key) {
        *value = Value::String("[REDACTED]".to_string());
        return;
    }

    match value {
        Value::Object(object) => {
            for (child_key, child) in object.iter_mut() {
                sanitize_value(child, Some(child_key));
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_value(item, None);
            }
        }
        Value::String(text) => {
            *text = truncate_chars(text, MAX_STRING_CHARS);
        }
        _ => {}
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    [
        "apikey",
        "authorization",
        "secret",
        "token",
        "password",
        "credential",
    ]
    .iter()
    .any(|candidate| normalized.contains(candidate))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn append_line(path: &Path, line: &str, max_file_bytes: u64) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    rotate_if_needed(path, max_file_bytes)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

fn rotate_if_needed(path: &Path, max_file_bytes: u64) -> Result<(), String> {
    if metadata(path).map(|value| value.len()).unwrap_or_default() < max_file_bytes {
        return Ok(());
    }
    let rotated = path.with_extension("jsonl.1");
    if rotated.exists() {
        remove_file(&rotated).map_err(|error| error.to_string())?;
    }
    rename(path, rotated).map_err(|error| error.to_string())
}

fn coach_log_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string())?;
    Ok(home.join(".meetly").join("coach-events.jsonl"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs::{read_to_string, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn sanitizes_sensitive_keys_and_bounds_strings() {
        let mut value = json!({
            "apiKey": "secret-value",
            "nested": { "authorization": "Bearer private", "safe": "x".repeat(600) }
        });
        sanitize_value(&mut value, None);

        assert_eq!(value["apiKey"], "[REDACTED]");
        assert_eq!(value["nested"]["authorization"], "[REDACTED]");
        assert_eq!(value["nested"]["safe"].as_str().unwrap().chars().count(), 512);
    }

    #[test]
    fn validates_narrow_entry_shape() {
        assert!(validate_entry(&json!({
            "schemaVersion": 1,
            "recordType": "event",
            "sessionId": "meeting-1",
            "recordedAtMs": 123
        }))
        .is_ok());
        assert!(validate_entry(&json!({
            "schemaVersion": 1,
            "recordType": "unknown",
            "sessionId": "meeting-1",
            "recordedAtMs": 123
        }))
        .is_err());
    }

    #[test]
    fn rotates_the_log_before_appending() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("meetly-coach-log-{suffix}"));
        let path = dir.join("coach-events.jsonl");
        create_dir_all(&dir).unwrap();
        write(&path, "123456789").unwrap();

        append_line(&path, "next", 4).unwrap();

        assert_eq!(read_to_string(&path).unwrap(), "next\n");
        assert_eq!(read_to_string(path.with_extension("jsonl.1")).unwrap(), "123456789");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
