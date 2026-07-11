//! HTTP contract for `/api/usage` — keep in sync with `packages/web/src/lib/types.ts`.

use serde::{Deserialize, Serialize};

/// Fixed non-Codex/OpenCode provider ids always present in `GET /api/usage`.
/// Codex / OpenCode may contribute one or more rows (`codex`, `codex-<slug>`, `opencode`, `opencode-<slug>`).
pub const FIXED_SERVICES: &[&str] = &["claude", "cursor"];

pub fn is_known_service_id(service: &str) -> bool {
    service == "codex"
        || service.starts_with("codex-")
        || service == "opencode"
        || service.starts_with("opencode-")
        || FIXED_SERVICES.contains(&service)
}

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
    /// Card title override (e.g. Codex account label).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Account email when known (Codex WHAM / id_token).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,
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
            display_name: None,
            account_email: None,
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
            display_name: None,
            account_email: None,
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
            display_name: None,
            account_email: None,
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

    pub fn with_display_name(mut self, name: impl Into<String>) -> Self {
        let s = name.into();
        self.display_name = if s.is_empty() { None } else { Some(s) };
        self
    }

    pub fn with_account_email(mut self, email: impl Into<String>) -> Self {
        let s = email.into().trim().to_string();
        self.account_email = if s.is_empty() { None } else { Some(s) };
        self
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}
