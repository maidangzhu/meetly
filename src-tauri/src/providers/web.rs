use serde::{Deserialize, Serialize};
use serde_json::json;

use super::secrets;

const EXA_SEARCH_URL: &str = "https://api.exa.ai/search";
const WEB_FETCH_TIMEOUT_SECS: u64 = 10;

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
pub async fn web_fetch(query: String, limit: Option<u8>) -> Result<WebFetchResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query is empty.".to_string());
    }

    let api_key = resolve_exa_api_key()?;
    let limit = clamp_limit(limit.unwrap_or(3));
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

    Err("EXA_API_KEY is required for web_fetch.".to_string())
}

fn normalize_exa_result(result: ExaResult) -> Option<WebFetchItem> {
    let url = result.url?;
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
