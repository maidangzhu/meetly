use serde::{Deserialize, Serialize};

/// Which provider slot a piece of config belongs to. Meetly has exactly two
/// slots: one STT provider, one LLM provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Stt,
    Llm,
}

impl ProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderKind::Stt => "stt",
            ProviderKind::Llm => "llm",
        }
    }
}

/// Non-secret provider fields. The API key is never part of this struct: it
/// lives in the system Keychain (see `secrets.rs`) and must never be
/// serialized alongside `base_url`/`model` or sent back to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
}

/// Default STT config: SiliconFlow's OpenAI-Whisper-compatible endpoint.
/// Chosen over Aliyun DashScope because DashScope's only non-streaming STT
/// path is an asynchronous recorded-file-transcription API (upload to a
/// public URL, submit a task, poll for completion), which does not match
/// the one-shot "POST audio, get text back" flow this project uses. See
/// openspec/changes/add-system-audio-transcription/design.md.
pub fn default_stt_config() -> ProviderConfig {
    ProviderConfig {
        base_url: "https://api.siliconflow.cn/v1/audio/transcriptions".to_string(),
        model: "FunAudioLLM/SenseVoiceSmall".to_string(),
    }
}

/// Default LLM config: SiliconFlow's OpenAI-compatible chat completions
/// endpoint. Any OpenAI-compatible provider works by overriding base_url,
/// model, and api_key; no code path changes.
pub fn default_llm_config() -> ProviderConfig {
    ProviderConfig {
        base_url: "https://api.siliconflow.cn/v1/chat/completions".to_string(),
        model: "Qwen/Qwen3-32B".to_string(),
    }
}

pub fn default_config_for(kind: ProviderKind) -> ProviderConfig {
    match kind {
        ProviderKind::Stt => default_stt_config(),
        ProviderKind::Llm => default_llm_config(),
    }
}

/// Result of a Settings-page connectivity test. `message` is always safe to
/// show the user and log: it must never contain the API key or a full
/// Authorization header value.
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticResult {
    pub success: bool,
    pub message: String,
}
