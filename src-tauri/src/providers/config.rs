use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
    XiaomiMimo,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderId::OpenAiCompatible => "openai_compatible",
            ProviderId::XiaomiMimo => "xiaomi_mimo",
        }
    }

    pub fn supports(self, kind: ProviderKind) -> bool {
        match self {
            ProviderId::OpenAiCompatible => true,
            ProviderId::XiaomiMimo => kind == ProviderKind::Stt,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider_id: ProviderId,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: ProviderId,
    pub display_name: &'static str,
    pub description: &'static str,
    pub default_base_url: &'static str,
    pub default_model: &'static str,
}

pub fn provider_descriptors(kind: ProviderKind) -> Vec<ProviderDescriptor> {
    let mut descriptors = vec![ProviderDescriptor {
        id: ProviderId::OpenAiCompatible,
        display_name: "OpenAI-compatible",
        description: match kind {
            ProviderKind::Stt => "Whisper-compatible multipart transcription API",
            ProviderKind::Llm => "OpenAI-compatible Chat Completions API",
        },
        default_base_url: match kind {
            ProviderKind::Stt => "https://api.siliconflow.cn/v1/audio/transcriptions",
            ProviderKind::Llm => "https://api.siliconflow.cn/v1/chat/completions",
        },
        default_model: match kind {
            ProviderKind::Stt => "FunAudioLLM/SenseVoiceSmall",
            ProviderKind::Llm => "Qwen/Qwen3-32B",
        },
    }];

    if kind == ProviderKind::Stt {
        descriptors.push(ProviderDescriptor {
            id: ProviderId::XiaomiMimo,
            display_name: "Xiaomi MiMo",
            description: "MiMo-V2.5-ASR JSON audio transcription API",
            default_base_url: "https://api.xiaomimimo.com/v1/chat/completions",
            default_model: "mimo-v2.5-asr",
        });
    }

    descriptors
}

pub fn default_stt_config() -> ProviderConfig {
    ProviderConfig {
        provider_id: ProviderId::OpenAiCompatible,
        base_url: "https://api.siliconflow.cn/v1/audio/transcriptions".to_string(),
        model: "FunAudioLLM/SenseVoiceSmall".to_string(),
    }
}

pub fn default_llm_config() -> ProviderConfig {
    ProviderConfig {
        provider_id: ProviderId::OpenAiCompatible,
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

pub(crate) fn infer_legacy_provider(kind: ProviderKind, base_url: &str, model: &str) -> ProviderId {
    if kind == ProviderKind::Stt
        && (base_url.contains("xiaomimimo.com") || model.eq_ignore_ascii_case("mimo-v2.5-asr"))
    {
        ProviderId::XiaomiMimo
    } else {
        ProviderId::OpenAiCompatible
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticResult {
    pub success: bool,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_mimo_stt_config_is_migrated_at_the_storage_boundary() {
        assert_eq!(
            infer_legacy_provider(
                ProviderKind::Stt,
                "https://api.xiaomimimo.com/v1/chat/completions",
                "mimo-v2.5-asr",
            ),
            ProviderId::XiaomiMimo
        );
        assert_eq!(
            infer_legacy_provider(
                ProviderKind::Llm,
                "https://api.deepseek.com/chat/completions",
                "deepseek-chat",
            ),
            ProviderId::OpenAiCompatible
        );
    }

    #[test]
    fn provider_choices_are_independent_per_kind() {
        assert_eq!(provider_descriptors(ProviderKind::Stt).len(), 2);
        assert_eq!(provider_descriptors(ProviderKind::Llm).len(), 1);
        assert!(!ProviderId::XiaomiMimo.supports(ProviderKind::Llm));
    }

    #[test]
    fn frontend_config_uses_camel_case_fields() {
        let value = serde_json::to_value(default_stt_config()).unwrap();
        assert_eq!(value["providerId"], "openai_compatible");
        assert!(value.get("baseUrl").is_some());
    }
}
