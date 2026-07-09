//! HTTP contract for `/api/usage` — keep in sync with `packages/web/src/lib/types.ts`.

use serde::{Deserialize, Serialize};

/// v1 provider ids. Always returned by `GET /api/usage`.
pub const V1_SERVICES: &[&str] = &["codex", "claude", "cursor", "opencode"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Ok,
    Error,
    NoCredentials,
    Throttled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used: String,
    pub remaining: String,
    pub resets_in: String,
    pub resets_at_ms: u64,
    pub used_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl UsageWindow {
    pub fn from_percent(used_percent: f64, resets_in: String, resets_at_ms: u64) -> Self {
        let pct = used_percent.clamp(0.0, 100.0);
        Self {
            used: format!("{pct:.1}%"),
            remaining: format!("{:.1}%", 100.0 - pct),
            resets_in,
            resets_at_ms,
            used_percent: pct,
            label: None,
        }
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceUsage {
    pub service: String,
    pub status: ServiceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub five_hour: Option<UsageWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seven_day: Option<UsageWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly: Option<UsageWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Credential/source that won (required when status is `ok`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl ServiceUsage {
    pub fn ok(service: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            status: ServiceStatus::Ok,
            error: None,
            hint: None,
            five_hour: None,
            seven_day: None,
            monthly: None,
            plan: None,
            source: Some(source.into()),
        }
    }

    pub fn error(service: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            status: ServiceStatus::Error,
            error: Some(error.into()),
            hint: None,
            five_hour: None,
            seven_day: None,
            monthly: None,
            plan: None,
            source: None,
        }
    }

    pub fn no_credentials(service: impl Into<String>, hint: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            status: ServiceStatus::NoCredentials,
            error: Some("No credentials found".into()),
            hint: Some(hint.into()),
            five_hour: None,
            seven_day: None,
            monthly: None,
            plan: None,
            source: None,
        }
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn with_plan(mut self, plan: impl Into<String>) -> Self {
        self.plan = Some(plan.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}
