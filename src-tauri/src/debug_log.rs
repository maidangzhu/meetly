use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn append(line: &str) -> Result<(), String> {
    let path = log_path()?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    writeln!(file, "{timestamp} {line}").map_err(|error| error.to_string())
}

#[tauri::command]
pub fn append_debug_log(message: String) -> Result<(), String> {
    append(&message)
}

fn log_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string())?;
    Ok(home.join(".meetly").join("debug.log"))
}
