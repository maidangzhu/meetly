use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioRunState {
    Idle,
    Listening,
    SetupRequired,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub state: AudioRunState,
    pub platform: String,
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub setup_required: bool,
    pub message: Option<String>,
}

#[derive(Debug, Default)]
pub struct AudioState {
    is_listening: Mutex<bool>,
    last_error: Mutex<Option<String>>,
}

#[tauri::command]
pub fn get_audio_status(state: tauri::State<AudioState>) -> AudioStatus {
    build_audio_status(&state, None)
}

#[tauri::command]
pub fn start_listening(state: tauri::State<AudioState>) -> AudioStatus {
    let status = probe_audio_status(false);

    if status.setup_required {
        set_listening(&state, false);
        set_last_error(&state, status.message.clone());
        return status;
    }

    set_listening(&state, true);
    set_last_error(&state, None);
    build_audio_status(&state, Some(AudioRunState::Listening))
}

#[tauri::command]
pub fn stop_listening(state: tauri::State<AudioState>) -> AudioStatus {
    set_listening(&state, false);
    build_audio_status(&state, Some(AudioRunState::Idle))
}

fn build_audio_status(state: &AudioState, override_state: Option<AudioRunState>) -> AudioStatus {
    let is_listening = state
        .is_listening
        .lock()
        .map(|guard| *guard)
        .unwrap_or(false);
    let last_error = state
        .last_error
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| Some("Failed to read audio state".to_string()));

    let mut status = probe_audio_status(is_listening);

    if let Some(next_state) = override_state {
        status.state = next_state;
    }

    if last_error.is_some() && !is_listening {
        status.message = last_error;
    }

    status
}

fn probe_audio_status(is_listening: bool) -> AudioStatus {
    let host = cpal::default_host();
    let input_device = host.default_input_device().and_then(|device| device.name().ok());
    let output_device = host.default_output_device().and_then(|device| device.name().ok());
    let output_probe_error = host
        .output_devices()
        .err()
        .map(|error| format!("Failed to enumerate output audio devices: {}", error));

    if let Some(message) = output_probe_error {
        return AudioStatus {
            state: AudioRunState::Error,
            platform: std::env::consts::OS.to_string(),
            input_device,
            output_device,
            setup_required: true,
            message: Some(message),
        };
    }

    let setup_required = output_device.is_none();
    let message = if setup_required {
        Some("No default output audio device found.".to_string())
    } else {
        None
    };

    AudioStatus {
        state: if setup_required {
            AudioRunState::SetupRequired
        } else if is_listening {
            AudioRunState::Listening
        } else {
            AudioRunState::Idle
        },
        platform: std::env::consts::OS.to_string(),
        input_device,
        output_device,
        setup_required,
        message,
    }
}

fn set_listening(state: &AudioState, value: bool) {
    if let Ok(mut guard) = state.is_listening.lock() {
        *guard = value;
    }
}

fn set_last_error(state: &AudioState, value: Option<String>) {
    if let Ok(mut guard) = state.last_error.lock() {
        *guard = value;
    }
}
