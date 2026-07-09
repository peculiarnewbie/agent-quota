//! Claude: OAuth credentials file / env → Anthropic oauth usage API.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use super::http;
use super::strategy::{StrategyError, StrategyResult};
use super::util::{env_nonempty, home_dir, read_json_file, window_from_iso};
use crate::types::ServiceUsage;

const SERVICE: &str = "claude";

struct OauthCreds {
    access_token: String,
    source: String,
}

fn resolve_oauth() -> Option<OauthCreds> {
    let home = home_dir()?;
    let paths = [
        home.join(".claude").join(".credentials.json"),
        home.join(".claude").join("credentials.json"),
        home.join(".config").join("claude").join("credentials.json"),
    ];
    for path in paths {
        if let Some(creds) = read_creds_file(&path) {
            return Some(creds);
        }
    }
    if let Some(token) = env_nonempty("CLAUDE_ACCESS_TOKEN") {
        return Some(OauthCreds {
            access_token: token,
            source: "env:CLAUDE_ACCESS_TOKEN".into(),
        });
    }
    None
}

fn read_creds_file(path: &PathBuf) -> Option<OauthCreds> {
    let creds = read_json_file(path)?;
    let token = creds
        .pointer("/claudeAiOauth/accessToken")
        .or_else(|| creds.get("accessToken"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?;
    Some(OauthCreds {
        access_token: token.to_string(),
        source: path.display().to_string(),
    })
}

async fn oauth_strategy() -> StrategyResult {
    let Some(creds) = resolve_oauth() else {
        return Err(StrategyError::unavailable("no Claude OAuth credentials"));
    };

    let mut headers = HashMap::new();
    headers.insert("Authorization", format!("Bearer {}", creds.access_token));
    headers.insert("anthropic-beta", "oauth-2025-04-20".into());
    headers.insert("Content-Type", "application/json".into());

    let resp = http::get("https://api.anthropic.com/api/oauth/usage", &headers)
        .await
        .map_err(|e| {
            StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
        })?;

    if resp.status == 401 {
        return Err(StrategyError::failed(
            "Token expired",
            Some("Run 'claude' to re-authenticate".into()),
            Some(creds.source),
        ));
    }

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

    Ok(parse_oauth_usage(&data, &creds.source))
}

fn parse_oauth_usage(data: &Value, source: &str) -> ServiceUsage {
    let mut usage = ServiceUsage::ok(SERVICE, source);

    if let Some(fh) = data.get("five_hour") {
        let util = fh.get("utilization").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let resets = fh.get("resets_at").and_then(|v| v.as_str());
        usage.five_hour = Some(window_from_iso(util, resets));
    }

    if let Some(sd) = data.get("seven_day") {
        let util = sd.get("utilization").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let resets = sd.get("resets_at").and_then(|v| v.as_str());
        usage.seven_day = Some(window_from_iso(util, resets));
    }

    usage
}

pub async fn fetch() -> ServiceUsage {
    let mut pipe = super::strategy::Pipeline::new(
        SERVICE,
        "Run 'claude' and authenticate first",
    );
    pipe.push(oauth_strategy().await);
    pipe.finish()
}
