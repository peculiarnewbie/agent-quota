//! Codex: OAuth (`~/.codex/auth.json`) → API key probe; multi-account via config.

use std::collections::HashMap;
use std::path::Path;

use base64::Engine;
use serde_json::Value;

use super::http;
use super::strategy::{Pipeline, StrategyError, StrategyResult};
use super::util::{env_nonempty, home_dir, read_json_file, window_from_reset_secs};
use crate::config::{AppConfig, CodexAccountConfig};
use crate::types::ServiceUsage;

struct OauthCreds {
    access_token: String,
    account_id: String,
    source: String,
    /// From id_token when available; WHAM may override.
    email: Option<String>,
}

struct ApiKeyCreds {
    api_key: String,
    source: String,
}

fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let padded = match payload.len() % 4 {
        2 => format!("{payload}=="),
        3 => format!("{payload}="),
        _ => payload.to_string(),
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&padded))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn resolve_local_oauth() -> Option<OauthCreds> {
    let home = home_dir()?;
    let paths = [
        home.join(".codex").join("auth.json"),
        home.join(".config").join("codex").join("auth.json"),
    ];
    for path in paths {
        if let Some(creds) = read_oauth_file(&path) {
            return Some(creds);
        }
    }
    None
}

fn read_oauth_file(path: &Path) -> Option<OauthCreds> {
    let auth = read_json_file(path)?;
    let tokens = auth.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.to_string();
    let account_id = tokens.get("account_id")?.as_str()?.to_string();
    if access_token.is_empty() || account_id.is_empty() {
        return None;
    }
    let email = tokens
        .get("id_token")
        .and_then(|v| v.as_str())
        .and_then(email_from_id_token);
    Some(OauthCreds {
        access_token,
        account_id,
        source: path.display().to_string(),
        email,
    })
}

fn resolve_local_api_key() -> Option<ApiKeyCreds> {
    if let Some(key) = env_nonempty("OPENAI_API_KEY") {
        return Some(ApiKeyCreds {
            api_key: key,
            source: "env:OPENAI_API_KEY".into(),
        });
    }
    let home = home_dir()?;
    for path in [
        home.join(".codex").join("auth.json"),
        home.join(".config").join("codex").join("auth.json"),
    ] {
        if let Some(auth) = read_json_file(&path) {
            if let Some(key) = auth
                .get("OPENAI_API_KEY")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Some(ApiKeyCreds {
                    api_key: key.to_string(),
                    source: path.display().to_string(),
                });
            }
        }
    }
    None
}

fn resolve_account_oauth(acct: &CodexAccountConfig) -> Option<OauthCreds> {
    let path = acct.auth_json_path()?;
    read_oauth_file(Path::new(path))
}

async fn oauth_wham(creds: &OauthCreds, service: &str) -> StrategyResult {
    let mut headers = HashMap::new();
    headers.insert("Authorization", format!("Bearer {}", creds.access_token));
    headers.insert("chatgpt-account-id", creds.account_id.clone());
    headers.insert("User-Agent", "codex-cli".into());
    headers.insert("Content-Type", "application/json".into());

    let resp = http::get("https://chatgpt.com/backend-api/wham/usage", &headers)
        .await
        .map_err(|e| {
            StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
        })?;

    if resp.status != 200 {
        return Err(StrategyError::failed(
            format!("HTTP {}", resp.status),
            Some(resp.truncate_hint(200)),
            Some(creds.source.clone()),
        ));
    }

    let Some(data) = resp.json() else {
        return Err(StrategyError::failed(
            "invalid JSON",
            Some(resp.truncate_hint(200)),
            Some(creds.source.clone()),
        ));
    };

    Ok(parse_wham_usage(
        &data,
        service,
        &creds.source,
        creds.email.as_deref(),
    ))
}

fn parse_wham_usage(
    data: &Value,
    service: &str,
    source: &str,
    fallback_email: Option<&str>,
) -> ServiceUsage {
    let mut usage = ServiceUsage::ok(service, source);

    if let Some(plan) = data.get("plan_type").and_then(|v| v.as_str()) {
        usage = usage.with_plan(plan);
    }

    let email = data
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| fallback_email.map(|s| s.to_string()));
    if let Some(email) = email {
        usage = usage.with_account_email(email);
    }

    if let Some(rl) = data.get("rate_limit") {
        if let Some(pw) = rl.get("primary_window") {
            let used = pw
                .get("used_percent")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let reset = pw
                .get("reset_after_seconds")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            usage.seven_day = Some(window_from_reset_secs(used, reset).with_label("weekly"));
        }
    }

    usage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primary_window_as_weekly_only() {
        let data = serde_json::json!({
            "rate_limit": {
                "primary_window": {
                    "used_percent": 14.0,
                    "reset_after_seconds": 518400
                },
                "secondary_window": {
                    "used_percent": 0.0,
                    "reset_after_seconds": 0
                }
            }
        });

        let usage = parse_wham_usage(&data, "codex", "test", None);

        assert!(usage.five_hour.is_none());
        let weekly = usage.seven_day.expect("Codex weekly window");
        assert_eq!(weekly.used_percent, 14.0);
        assert_eq!(weekly.label.as_deref(), Some("weekly"));
    }
}

async fn api_key_probe(creds: &ApiKeyCreds, service: &str) -> StrategyResult {
    let mut headers = HashMap::new();
    headers.insert("Authorization", format!("Bearer {}", creds.api_key));
    headers.insert("Content-Type", "application/json".into());

    let resp = http::get("https://api.openai.com/v1/models", &headers)
        .await
        .map_err(|e| {
            StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
        })?;

    if resp.status == 200 {
        return Ok(ServiceUsage::ok(service, &creds.source)
            .with_hint("API key valid — subscription quota requires OAuth login"));
    }

    Err(StrategyError::failed(
        format!("HTTP {}", resp.status),
        Some("Run 'codex login' to re-authenticate".into()),
        Some(creds.source.clone()),
    ))
}

fn apply_display_name(mut usage: ServiceUsage, label: Option<&str>) -> ServiceUsage {
    if let Some(name) = label.map(str::trim).filter(|s| !s.is_empty()) {
        usage = usage.with_display_name(name);
    }
    usage
}

async fn fetch_local(label: Option<&str>) -> ServiceUsage {
    let service = "codex";
    let mut pipe = Pipeline::new(service, "Run 'codex login' or set OPENAI_API_KEY");

    if let Some(creds) = resolve_local_oauth() {
        pipe.push(oauth_wham(&creds, service).await);
    } else {
        pipe.push(Err(StrategyError::unavailable(
            "no ~/.codex/auth.json OAuth tokens",
        )));
    }

    if !pipe.is_done() {
        if let Some(creds) = resolve_local_api_key() {
            pipe.push(api_key_probe(&creds, service).await);
        } else {
            pipe.push(Err(StrategyError::unavailable("no OPENAI_API_KEY")));
        }
    }

    apply_display_name(pipe.finish(), label)
}

async fn fetch_from_auth_json(acct: CodexAccountConfig) -> ServiceUsage {
    let service = acct.service_id();
    let label = acct.label.clone();
    let hint = "Set authJson path in Settings (or ~/.config/agent-quota/config.json)";
    let mut pipe = Pipeline::new(service.as_str(), hint);

    match resolve_account_oauth(&acct) {
        Some(creds) => pipe.push(oauth_wham(&creds, service.as_str()).await),
        None => pipe.push(Err(StrategyError::unavailable(
            "no readable OAuth tokens at authJson path",
        ))),
    }

    apply_display_name(pipe.finish(), label.as_deref())
}

async fn fetch_account(acct: CodexAccountConfig) -> ServiceUsage {
    if acct.auth_json_path().is_some() {
        return fetch_from_auth_json(acct).await;
    }
    if acct.is_local_default() {
        return fetch_local(acct.label.as_deref()).await;
    }
    apply_display_name(
        ServiceUsage::no_credentials(
            &acct.service_id(),
            "Set authJson path in Settings (or ~/.config/agent-quota/config.json)",
        ),
        acct.label.as_deref(),
    )
}

/// Fetch a single configured Codex row by service id (`codex` / `codex-<slug>`).
pub async fn fetch_one_configured(cfg: &AppConfig, service: &str) -> Option<ServiceUsage> {
    if cfg.codex_accounts.is_empty() {
        if service == "codex" {
            return Some(fetch_local(None).await);
        }
        return None;
    }

    for acct in &cfg.codex_accounts {
        if acct.service_id() == service {
            return Some(fetch_account(acct.clone()).await);
        }
    }
    None
}

/// Fetch all configured Codex rows (local default + extras).
pub async fn fetch_all_configured(cfg: &AppConfig) -> Vec<ServiceUsage> {
    if cfg.codex_accounts.is_empty() {
        return vec![fetch_local(None).await];
    }

    let mut handles = Vec::new();
    let mut order: Vec<String> = Vec::new();

    for acct in &cfg.codex_accounts {
        order.push(acct.service_id());
        let acct = acct.clone();
        handles.push(tokio::spawn(async move { fetch_account(acct).await }));
    }

    let mut by_service = std::collections::HashMap::new();
    for handle in handles {
        match handle.await {
            Ok(usage) => {
                by_service.insert(usage.service.clone(), usage);
            }
            Err(e) => {
                eprintln!("[codex] task join error: {e}");
            }
        }
    }

    let mut out: Vec<ServiceUsage> = order
        .into_iter()
        .filter_map(|id| by_service.remove(&id))
        .collect();

    for (_, usage) in by_service {
        out.push(usage);
    }

    if out.is_empty() {
        out.push(fetch_local(None).await);
    }
    out
}
