use super::config::ProviderId;
use reqwest::StatusCode;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderFailureKind {
    Authentication,
    Permission,
    RateLimited,
    InvalidRequest,
    Connect,
    Timeout,
    ServiceUnavailable,
    InvalidResponse,
    Internal,
}

impl ProviderFailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Authentication => "authentication",
            Self::Permission => "permission",
            Self::RateLimited => "rate_limited",
            Self::InvalidRequest => "invalid_request",
            Self::Connect => "connect",
            Self::Timeout => "timeout",
            Self::ServiceUnavailable => "service_unavailable",
            Self::InvalidResponse => "invalid_response",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug)]
pub struct ProviderFailure {
    pub provider_id: ProviderId,
    pub kind: ProviderFailureKind,
    pub retryable: bool,
    pub diagnostic_code: Option<String>,
    message: String,
}

impl ProviderFailure {
    pub fn new(
        provider_id: ProviderId,
        kind: ProviderFailureKind,
        retryable: bool,
        message: impl Into<String>,
    ) -> Self {
        Self {
            provider_id,
            kind,
            retryable,
            diagnostic_code: None,
            message: message.into(),
        }
    }

    pub fn invalid_request(provider_id: ProviderId, message: impl Into<String>) -> Self {
        Self::new(
            provider_id,
            ProviderFailureKind::InvalidRequest,
            false,
            message,
        )
    }

    pub fn invalid_response(provider_id: ProviderId, message: impl Into<String>) -> Self {
        Self::new(
            provider_id,
            ProviderFailureKind::InvalidResponse,
            false,
            message,
        )
    }

    pub fn transport(provider_id: ProviderId, error: reqwest::Error) -> Self {
        let kind = if error.is_timeout() {
            ProviderFailureKind::Timeout
        } else if error.is_connect() {
            ProviderFailureKind::Connect
        } else {
            ProviderFailureKind::Internal
        };
        Self::new(provider_id, kind, true, error.to_string())
    }

    pub fn http(provider_id: ProviderId, status: StatusCode, body: &str) -> Self {
        let (kind, retryable) = match status.as_u16() {
            401 => (ProviderFailureKind::Authentication, false),
            403 => (ProviderFailureKind::Permission, false),
            429 => (ProviderFailureKind::RateLimited, true),
            400..=499 => (ProviderFailureKind::InvalidRequest, false),
            500..=599 => (ProviderFailureKind::ServiceUnavailable, true),
            _ => (ProviderFailureKind::Internal, false),
        };
        let body = safe_error_message(body);
        let mut failure = Self::new(
            provider_id,
            kind,
            retryable,
            format!("HTTP {status}: {body}"),
        );
        failure.diagnostic_code = Some(status.as_u16().to_string());
        failure
    }
}

fn safe_error_message(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return "Provider returned a non-JSON error response.".to_string();
    };
    let error = value.get("error").unwrap_or(&value);
    let message = error
        .get("message")
        .and_then(serde_json::Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("Provider rejected the request.");
    let code = error.get("code").and_then(|code| {
        code.as_str()
            .map(str::to_string)
            .or_else(|| Some(code.to_string()))
    });
    let message = message.chars().take(500).collect::<String>();
    match code {
        Some(code) => format!("{message} (provider_code={code})"),
        None => message,
    }
}

impl fmt::Display for ProviderFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} {} (retryable={}): {}",
            self.provider_id.as_str(),
            self.kind.as_str(),
            self.retryable,
            self.message
        )
    }
}

impl std::error::Error for ProviderFailure {}

pub type ProviderResult<T> = Result<T, ProviderFailure>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_safe_json_error_without_returning_the_whole_body() {
        let body = r#"{"error":{"code":"400","message":"Invalid JSON"},"private":"hidden"}"#;
        let message = safe_error_message(body);
        assert_eq!(message, "Invalid JSON (provider_code=400)");
        assert!(!message.contains("private"));
    }
}
