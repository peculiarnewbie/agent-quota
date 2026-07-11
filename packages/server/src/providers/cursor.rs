//! Cursor: env/token file → Linux state.vscdb → Connect RPC usage APIs.

use std::collections::HashMap;
use std::path::PathBuf;

use base64::Engine as _;
use serde_json::{json, Value};

use super::http;
use super::strategy::{StrategyError, StrategyResult};
use super::util::{env_nonempty, format_reset_iso, home_dir, now_ms, read_json_file};
use crate::types::{ServiceUsage, UsageWindow};

const SERVICE: &str = "cursor";
const CURSOR_USAGE_URL: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CURSOR_PLAN_URL: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_CREDITS_URL: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCreditGrantsBalance";
const CURSOR_REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CURSOR_CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

struct CursorCreds {
    access_token: String,
    refresh_token: Option<String>,
    source: String,
}

fn creds_from_json(path: &PathBuf, cfg: &serde_json::Value) -> Option<CursorCreds> {
    let access = cfg
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let refresh_token = cfg
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some(CursorCreds {
        access_token: access,
        refresh_token,
        source: path.display().to_string(),
    })
}

fn resolve_token_file() -> Option<CursorCreds> {
    if let Some(access) = env_nonempty("CURSOR_ACCESS_TOKEN") {
        return Some(CursorCreds {
            access_token: access,
            refresh_token: env_nonempty("CURSOR_REFRESH_TOKEN"),
            source: "env:CURSOR_*".into(),
        });
    }

    let home = home_dir()?;
    let xdg = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));

    let paths = [
        // Cursor agent / CLI auth on Linux
        xdg.join("cursor").join("auth.json"),
        home.join(".config").join("cursor").join("auth.json"),
        // Manual / opencode-quota drop-ins
        home.join(".config")
            .join("opencode")
            .join("opencode-quota")
            .join("cursor.json"),
        home.join(".opencode-quota").join("cursor.json"),
    ];
    for path in paths {
        if let Some(cfg) = read_json_file(&path) {
            if let Some(creds) = creds_from_json(&path, &cfg) {
                return Some(creds);
            }
        }
    }
    None
}

fn resolve_vscdb() -> Option<CursorCreds> {
    let home = home_dir()?;
    let xdg = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));

    let candidates = [
        // Linux desktop app (capital C) and agent/CLI layout (lowercase)
        xdg.join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
        xdg.join("cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
        // Windows path kept for completeness when running under Wine / dual-boot mounts
        home.join("AppData")
            .join("Roaming")
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
        // macOS
        home.join("Library")
            .join("Application Support")
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
    ];

    for path in candidates {
        if let Some(creds) = read_vscdb(&path) {
            return Some(creds);
        }
    }
    None
}

fn read_vscdb(path: &PathBuf) -> Option<CursorCreds> {
    if !path.exists() {
        return None;
    }
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .ok()?;

    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/refreshToken')",
        )
        .ok()?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()?;

    let mut access_token = None;
    let mut refresh_token = None;
    for row in rows.flatten() {
        match row.0.as_str() {
            "cursorAuth/accessToken" => access_token = Some(row.1),
            "cursorAuth/refreshToken" => refresh_token = Some(row.1),
            _ => {}
        }
    }

    let access_token = access_token.filter(|s| !s.is_empty())?;
    Some(CursorCreds {
        access_token,
        refresh_token,
        source: format!("Cursor state.vscdb ({})", path.display()),
    })
}

fn jwt_exp_ms(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    // JWT uses base64url without padding
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let bytes = engine.decode(payload).ok().or_else(|| {
        base64::engine::general_purpose::URL_SAFE
            .decode(payload)
            .ok()
    })?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let exp = value.get("exp")?.as_u64()?;
    Some(exp.saturating_mul(1000))
}

async fn refresh_access_token(refresh_token: &str) -> Option<String> {
    let mut headers = HashMap::new();
    headers.insert("Content-Type", "application/json".into());
    let body = json!({
        "grant_type": "refresh_token",
        "client_id": CURSOR_CLIENT_ID,
        "refresh_token": refresh_token,
    });
    let resp = http::post_json(CURSOR_REFRESH_URL, &headers, &body).await.ok()?;
    if resp.status != 200 {
        return None;
    }
    resp.json()?
        .get("access_token")?
        .as_str()
        .map(|s| s.to_string())
}

async fn connect_post(url: &str, token: &str) -> Result<http::HttpResponse, String> {
    let mut headers = HashMap::new();
    headers.insert("Authorization", format!("Bearer {token}"));
    headers.insert("Content-Type", "application/json".into());
    headers.insert("Connect-Protocol-Version", "1".into());
    http::post_json(url, &headers, &json!({})).await
}

/// Cursor's Connect API currently serializes epoch-millisecond fields as strings,
/// though older responses used JSON numbers.
fn epoch_ms(value: Option<&Value>) -> Option<u64> {
    value.and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_f64().map(|n| n as u64))
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}

async fn fetch_with_creds(mut creds: CursorCreds) -> StrategyResult {
    // Refresh if near expiry
    if let Some(exp) = jwt_exp_ms(&creds.access_token) {
        if now_ms() > exp.saturating_sub(5 * 60 * 1000) {
            let Some(refresh) = creds.refresh_token.as_deref() else {
                return Err(StrategyError::failed(
                    "Token expired",
                    Some("Re-sign in to Cursor, or provide CURSOR_REFRESH_TOKEN".into()),
                    Some(creds.source),
                ));
            };
            match refresh_access_token(refresh).await {
                Some(token) => creds.access_token = token,
                None => {
                    return Err(StrategyError::failed(
                        "Token refresh failed",
                        Some("Re-sign in to Cursor".into()),
                        Some(creds.source),
                    ));
                }
            }
        }
    }

    let usage_resp = connect_post(CURSOR_USAGE_URL, &creds.access_token)
        .await
        .map_err(|e| {
            StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
        })?;

    if usage_resp.status == 401 || usage_resp.status == 403 {
        return Err(StrategyError::failed(
            "Auth rejected",
            Some("Re-sign in to Cursor".into()),
            Some(creds.source),
        ));
    }

    if usage_resp.status != 200 {
        return Err(StrategyError::failed(
            format!("HTTP {}", usage_resp.status),
            Some("Check Cursor subscription status".into()),
            Some(creds.source),
        ));
    }

    let Some(usage) = usage_resp.json() else {
        return Err(StrategyError::failed(
            "invalid JSON",
            Some(usage_resp.truncate_hint(200)),
            Some(creds.source),
        ));
    };

    let Some(plan_usage) = usage.get("planUsage") else {
        return Err(StrategyError::failed(
            "No active subscription",
            Some("Check your Cursor plan".into()),
            Some(creds.source),
        ));
    };

    if plan_usage.get("limit").and_then(|v| v.as_f64()).is_none()
        && plan_usage
            .get("totalPercentUsed")
            .and_then(|v| v.as_f64())
            .is_none()
    {
        return Err(StrategyError::failed(
            "No active subscription",
            Some("Check your Cursor plan".into()),
            Some(creds.source),
        ));
    }

    let mut result = ServiceUsage::ok(SERVICE, &creds.source);

    if let Ok(plan_resp) = connect_post(CURSOR_PLAN_URL, &creds.access_token).await {
        if let Some(plan_data) = plan_resp.json() {
            if let Some(name) = plan_data
                .pointer("/planInfo/planName")
                .and_then(|v| v.as_str())
            {
                result = result.with_plan(name);
            }
        }
    }

    let limit = plan_usage.get("limit").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total_spend = plan_usage
        .get("totalSpend")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let pct_used = plan_usage
        .get("totalPercentUsed")
        .and_then(|v| v.as_f64())
        .unwrap_or(if limit > 0.0 {
            (total_spend / limit) * 100.0
        } else {
            0.0
        });

    let cycle_start = epoch_ms(usage.get("billingCycleStart"));
    let cycle_end = epoch_ms(usage.get("billingCycleEnd"));
    let resets_at_ms = cycle_end.unwrap_or(0);
    let period_ms = match (cycle_start, cycle_end) {
        (Some(s), Some(e)) if e > s => e - s,
        _ => 30 * 24 * 60 * 60 * 1000,
    };
    let days = (period_ms / 86_400_000).max(1);
    let resets_in = if resets_at_ms > 0 {
        let iso = time::OffsetDateTime::from_unix_timestamp((resets_at_ms / 1000) as i64)
            .ok()
            .and_then(|dt| dt.format(&time::format_description::well_known::Rfc3339).ok());
        iso.map(|s| format_reset_iso(&s).0)
            .unwrap_or_else(|| "--".into())
    } else {
        "--".into()
    };

    result.monthly = Some(
        UsageWindow::from_percent(pct_used, resets_in, resets_at_ms)
            .with_label(format!("{days}d usage")),
    );

    if let Ok(credits_resp) = connect_post(CURSOR_CREDITS_URL, &creds.access_token).await {
        if let Some(cg) = credits_resp.json() {
            if cg.get("hasCreditGrants").and_then(|v| v.as_bool()) == Some(true) {
                let total_cents = cg
                    .get("totalCents")
                    .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()))
                    .unwrap_or(0);
                let used_cents = cg
                    .get("usedCents")
                    .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()))
                    .unwrap_or(0);
                if total_cents > 0 {
                    let used_pct = (used_cents as f64 / total_cents as f64) * 100.0;
                    result.seven_day = Some(UsageWindow {
                        used: format!("${:.2}", used_cents as f64 / 100.0),
                        remaining: format!(
                            "${:.2}",
                            (total_cents - used_cents) as f64 / 100.0
                        ),
                        resets_in: "--".into(),
                        resets_at_ms: 0,
                        used_percent: used_pct,
                        label: Some("credits".into()),
                    });
                }
            }
        }
    }

    Ok(result)
}

async fn token_strategy() -> StrategyResult {
    let Some(creds) = resolve_token_file() else {
        return Err(StrategyError::unavailable("no CURSOR_* env or cursor.json"));
    };
    fetch_with_creds(creds).await
}

async fn vscdb_strategy() -> StrategyResult {
    let Some(creds) = resolve_vscdb() else {
        return Err(StrategyError::unavailable("no Cursor state.vscdb"));
    };
    fetch_with_creds(creds).await
}

pub async fn fetch() -> ServiceUsage {
    let mut pipe = super::strategy::Pipeline::new(
        SERVICE,
        "Sign in to Cursor app, or set CURSOR_ACCESS_TOKEN",
    );
    pipe.push(token_strategy().await);
    if !pipe.is_done() {
        pipe.push(vscdb_strategy().await);
    }
    pipe.finish()
}
