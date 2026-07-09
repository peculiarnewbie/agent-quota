//! Codex: OAuth (`~/.codex/auth.json`) → API key probe.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use super::http;
use super::strategy::{StrategyError, StrategyResult};
use super::util::{env_nonempty, home_dir, read_json_file, window_from_reset_secs};
use crate::types::ServiceUsage;

const SERVICE: &str = "codex";

struct OauthCreds {
    access_token: String,
    account_id: String,
    source: String,
}

struct ApiKeyCreds {
    api_key: String,
    source: String,
}

fn resolve_oauth() -> Option<OauthCreds> {
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

fn read_oauth_file(path: &PathBuf) -> Option<OauthCreds> {
    let auth = read_json_file(path)?;
    let tokens = auth.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.to_string();
    let account_id = tokens.get("account_id")?.as_str()?.to_string();
    if access_token.is_empty() || account_id.is_empty() {
        return None;
    }
    Some(OauthCreds {
        access_token,
        account_id,
        source: path.display().to_string(),
    })
}

fn resolve_api_key() -> Option<ApiKeyCreds> {
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

async fn oauth_strategy() -> StrategyResult {
    let Some(creds) = resolve_oauth() else {
        return Err(StrategyError::unavailable("no ~/.codex/auth.json OAuth tokens"));
    };

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
            Some(creds.source),
        ));
    }

    let Some(data) = resp.json() else {
        return Err(StrategyError::failed(
            "invalid JSON",
            Some(resp.truncate_hint(200)),
            Some(creds.source),
        ));
    };

    Ok(parse_wham_usage(&data, &creds.source))
}

fn parse_wham_usage(data: &Value, source: &str) -> ServiceUsage {
    let mut usage = ServiceUsage::ok(SERVICE, source);

    if let Some(plan) = data.get("plan_type").and_then(|v| v.as_str()) {
        usage = usage.with_plan(plan);
    }

    if let Some(rl) = data.get("rate_limit") {
        if let Some(pw) = rl.get("primary_window") {
            let used = pw.get("used_percent").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let reset = pw
                .get("reset_after_seconds")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            usage.five_hour = Some(window_from_reset_secs(used, reset));
        }
        if let Some(sw) = rl.get("secondary_window") {
            let used = sw.get("used_percent").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let reset = sw
                .get("reset_after_seconds")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            usage.seven_day = Some(window_from_reset_secs(used, reset));
        }
    }

    usage
}

async fn api_key_strategy() -> StrategyResult {
    let Some(creds) = resolve_api_key() else {
        return Err(StrategyError::unavailable("no OPENAI_API_KEY"));
    };

    let mut headers = HashMap::new();
    headers.insert("Authorization", format!("Bearer {}", creds.api_key));
    headers.insert("Content-Type", "application/json".into());

    let resp = http::get("https://api.openai.com/v1/models", &headers)
        .await
        .map_err(|e| {
            StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
        })?;

    if resp.status == 200 {
        return Ok(ServiceUsage::ok(SERVICE, &creds.source)
            .with_hint("API key valid — subscription quota requires OAuth login"));
    }

    Err(StrategyError::failed(
        format!("HTTP {}", resp.status),
        Some("Run 'codex login' to re-authenticate".into()),
        Some(creds.source),
    ))
}

pub async fn fetch() -> ServiceUsage {
    let mut pipe = super::strategy::Pipeline::new(
        SERVICE,
        "Run 'codex login' or set OPENAI_API_KEY",
    );
    pipe.push(oauth_strategy().await);
    if !pipe.is_done() {
        pipe.push(api_key_strategy().await);
    }
    pipe.finish()
}
