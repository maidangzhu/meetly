use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::{config::DiagnosticResult, secrets};

const EXA_SEARCH_URL: &str = "https://api.exa.ai/search";
const WEB_FETCH_TIMEOUT_SECS: u64 = 10;
const WEB_SEARCH_CONFIG_FILE_NAME: &str = "web_search_config.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebSearchProvider {
    Exa,
}

impl WebSearchProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exa => "exa",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchConfig {
    pub enabled: bool,
    pub provider: WebSearchProvider,
}

impl Default for WebSearchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: WebSearchProvider::Exa,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchSettings {
    pub enabled: bool,
    pub provider: WebSearchProvider,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResult {
    pub provider: String,
    pub query: String,
    pub results: Vec<WebFetchItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchItem {
    pub title: String,
    pub url: String,
    pub snippet: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(WEB_SEARCH_CONFIG_FILE_NAME))
        .map_err(|error| error.to_string())
}

pub fn get_config(app: &AppHandle) -> Result<WebSearchConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(WebSearchConfig::default());
    }

    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn save_config(app: &AppHandle, config: &WebSearchConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn settings(app: &AppHandle) -> Result<WebSearchSettings, String> {
    let config = get_config(app)?;
    Ok(WebSearchSettings {
        enabled: config.enabled,
        provider: config.provider,
        has_api_key: resolve_exa_api_key().is_ok(),
    })
}

#[tauri::command]
pub async fn get_web_search_config(app: AppHandle) -> Result<WebSearchSettings, String> {
    settings(&app)
}

#[tauri::command]
pub async fn save_web_search_config(
    app: AppHandle,
    enabled: bool,
    provider: WebSearchProvider,
    api_key: String,
) -> Result<WebSearchSettings, String> {
    let api_key = api_key.trim();
    if !api_key.is_empty() {
        secrets::set_exa_api_key(api_key).map_err(|error| error.to_string())?;
    }
    if enabled && resolve_exa_api_key().is_err() {
        return Err("Configure an Exa API key before enabling web search.".to_string());
    }

    save_config(&app, &WebSearchConfig { enabled, provider })?;
    settings(&app)
}

#[tauri::command]
pub async fn test_web_search_config(app: AppHandle) -> DiagnosticResult {
    match search_web_with_exa(&app, "Exa search API", 1, false).await {
        Ok(result) => DiagnosticResult {
            success: true,
            message: format!(
                "Exa search is reachable ({} result{}).",
                result.results.len(),
                if result.results.len() == 1 { "" } else { "s" }
            ),
        },
        Err(message) => DiagnosticResult {
            success: false,
            message,
        },
    }
}

#[derive(Debug, Deserialize)]
struct ExaResponse {
    #[serde(default)]
    results: Vec<ExaResult>,
}

#[derive(Debug, Deserialize)]
struct ExaResult {
    title: Option<String>,
    url: Option<String>,
    snippet: Option<String>,
    description: Option<String>,
    summary: Option<String>,
    text: Option<String>,
    #[serde(default)]
    highlights: Vec<String>,
}

#[tauri::command]
pub async fn web_fetch(
    app: AppHandle,
    query: String,
    limit: Option<u8>,
) -> Result<WebFetchResult, String> {
    search_web_with_exa(&app, &query, limit.unwrap_or(3), true).await
}

pub async fn search_web_with_exa(
    app: &AppHandle,
    query: &str,
    limit: u8,
    require_enabled: bool,
) -> Result<WebFetchResult, String> {
    let config = get_config(app)?;
    if config.provider != WebSearchProvider::Exa {
        return Err(format!(
            "Web search provider {} is not supported.",
            config.provider.as_str()
        ));
    }
    if require_enabled && !config.enabled {
        return Err("Web search is disabled in Settings.".to_string());
    }

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query is empty.".to_string());
    }

    let api_key = resolve_exa_api_key()?;
    let limit = clamp_limit(limit);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(WEB_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(EXA_SEARCH_URL)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .json(&json!({
            "query": trimmed,
            "numResults": limit,
            "type": "fast",
            "contents": {
                "highlights": true
            }
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Exa search failed with status {status}"));
    }

    let body = response
        .json::<ExaResponse>()
        .await
        .map_err(|error| error.to_string())?;

    let results = body
        .results
        .into_iter()
        .filter_map(normalize_exa_result)
        .take(limit as usize)
        .collect();

    Ok(WebFetchResult {
        provider: "exa".to_string(),
        query: trimmed.to_string(),
        results,
    })
}

fn resolve_exa_api_key() -> Result<String, String> {
    if let Ok(Some(api_key)) = secrets::get_exa_api_key() {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(api_key) = std::env::var("EXA_API_KEY") {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err("An Exa API key is required for web_search.".to_string())
}

fn normalize_exa_result(result: ExaResult) -> Option<WebFetchItem> {
    let url = normalize_http_url(result.url?)?;
    let title = result.title.unwrap_or_else(|| url.clone());
    let snippet = result
        .snippet
        .or(result.description)
        .or(result.summary)
        .or_else(|| {
            result
                .highlights
                .into_iter()
                .find(|item| !item.trim().is_empty())
        })
        .or(result.text)
        .map(|text| truncate_chars(&text.replace('\n', " "), 700));

    Some(WebFetchItem {
        title: truncate_chars(&title, 160),
        url,
        snippet,
    })
}

fn normalize_http_url(value: String) -> Option<String> {
    let url = reqwest::Url::parse(&value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn clamp_limit(limit: u8) -> u8 {
    limit.clamp(1, 5)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_search_is_disabled_by_default() {
        let config = WebSearchConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.provider, WebSearchProvider::Exa);
    }

    #[test]
    fn web_search_config_uses_frontend_wire_names() {
        let value = serde_json::to_value(WebSearchConfig {
            enabled: true,
            provider: WebSearchProvider::Exa,
        })
        .unwrap();
        assert_eq!(value["enabled"], true);
        assert_eq!(value["provider"], "exa");
    }

    #[test]
    fn exa_results_prefer_highlights_and_clamp_limits() {
        let item = normalize_exa_result(ExaResult {
            title: Some("Source".to_string()),
            url: Some("https://example.com".to_string()),
            snippet: None,
            description: None,
            summary: None,
            text: Some("fallback".to_string()),
            highlights: vec!["primary highlight".to_string()],
        })
        .unwrap();

        assert_eq!(item.snippet.as_deref(), Some("primary highlight"));
        assert_eq!(clamp_limit(0), 1);
        assert_eq!(clamp_limit(8), 5);
    }

    #[test]
    fn exa_results_reject_non_http_urls() {
        let item = normalize_exa_result(ExaResult {
            title: Some("Unsafe".to_string()),
            url: Some("javascript:alert(1)".to_string()),
            snippet: None,
            description: None,
            summary: None,
            text: None,
            highlights: Vec::new(),
        });
        assert!(item.is_none());
    }
}
