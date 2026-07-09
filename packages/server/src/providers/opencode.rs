//! OpenCode Go: env/manual cookie + workspace → dashboard HTML parse.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;

use super::http;
use super::strategy::{StrategyError, StrategyResult};
use super::util::{env_nonempty, home_dir, read_json_file, window_from_reset_secs};
use crate::types::ServiceUsage;

const SERVICE: &str = "opencode";

struct GoCreds {
    workspace_id: String,
    auth_cookie: String,
    source: String,
}

struct UsagePct {
    usage_percent: f64,
    reset_in_sec: i64,
}

fn resolve_creds() -> Option<GoCreds> {
    let workspace_id = env_nonempty("OPENCODE_GO_WORKSPACE_ID")
        .or_else(|| env_nonempty("CODEXBAR_OPENCODEGO_WORKSPACE_ID"))
        .or_else(|| env_nonempty("CODEXBAR_OPENCODE_WORKSPACE_ID"));
    let auth_cookie = env_nonempty("OPENCODE_GO_AUTH_COOKIE");
    if let (Some(workspace_id), Some(auth_cookie)) = (workspace_id, auth_cookie) {
        return Some(GoCreds {
            workspace_id,
            auth_cookie,
            source: "env:OPENCODE_GO_*".into(),
        });
    }

    let home = home_dir()?;
    let paths = [
        home.join(".config")
            .join("opencode")
            .join("opencode-quota")
            .join("opencode-go.json"),
        home.join(".opencode-quota").join("opencode-go.json"),
    ];
    for path in paths {
        if let Some(cfg) = read_json_file(&path) {
            let workspace_id = cfg
                .get("workspaceId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let auth_cookie = cfg
                .get("authCookie")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let (Some(workspace_id), Some(auth_cookie)) = (workspace_id, auth_cookie) {
                return Some(GoCreds {
                    workspace_id,
                    auth_cookie,
                    source: path.display().to_string(),
                });
            }
        }
    }
    None
}

fn html_to_text(html: &str) -> String {
    let no_comments = Regex::new(r"(?s)<!--.*?-->").unwrap().replace_all(html, " ");
    let no_scripts = Regex::new(r"(?is)<script\b[^>]*>.*?</script>")
        .unwrap()
        .replace_all(&no_comments, " ");
    let no_styles = Regex::new(r"(?is)<style\b[^>]*>.*?</style>")
        .unwrap()
        .replace_all(&no_scripts, " ");
    let no_tags = Regex::new(r"<[^>]+>")
        .unwrap()
        .replace_all(&no_styles, " ");
    no_tags.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_duration_seconds(value: &str) -> Option<i64> {
    let re = Regex::new(r"(?i)(\d+)\s*(weeks?|days?|hours?|minutes?|seconds?|w|d|h|m|s)\b").ok()?;
    let mut total = 0i64;
    let mut matched = false;
    for caps in re.captures_iter(value) {
        let amount: i64 = caps.get(1)?.as_str().parse().ok()?;
        let unit = caps.get(2)?.as_str().to_lowercase();
        matched = true;
        total += if unit == "w" || unit.starts_with("week") {
            amount * 604800
        } else if unit == "d" || unit.starts_with("day") {
            amount * 86400
        } else if unit == "h" || unit.starts_with("hour") {
            amount * 3600
        } else if unit == "m" || unit.starts_with("minute") {
            amount * 60
        } else if unit == "s" || unit.starts_with("second") {
            amount
        } else {
            0
        };
    }
    matched.then_some(total)
}

fn parse_text_window(text: &str, label: &str) -> Option<UsagePct> {
    let lower = text.to_lowercase();
    let lower_label = label.to_lowercase();
    let start = lower.find(&lower_label)?;
    let next_labels = [
        "rolling usage",
        "weekly usage",
        "monthly usage",
        "use your available balance",
    ];
    let mut end = text.len();
    for next in next_labels {
        if next == lower_label {
            continue;
        }
        if let Some(idx) = lower[start + lower_label.len()..].find(next) {
            let abs = start + lower_label.len() + idx;
            if abs < end {
                end = abs;
            }
        }
    }
    let section = &text[start..end];
    let pct_re = Regex::new(r"(?i)(\d{1,3}(?:\.\d+)?)\s*%").ok()?;
    let usage_percent: f64 = pct_re.captures(section)?.get(1)?.as_str().parse().ok()?;
    let reset_idx = section.to_lowercase().find("resets in")?;
    let reset_in_sec = parse_duration_seconds(&section[reset_idx + "resets in".len()..])?;
    Some(UsagePct {
        usage_percent,
        reset_in_sec,
    })
}

fn monthly_regexes() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        vec![
            Regex::new(r"(?i)monthlyUsage:\$R\[\d+\]\s*=\s*\{[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*resetInSec\s*:\s*(\d+)[^{}]*\}").unwrap(),
            Regex::new(r"(?i)monthlyUsage:\$R\[\d+\]\s*=\s*\{[^{}]*resetInSec\s*:\s*(\d+)[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*\}").unwrap(),
            Regex::new(r"(?i)monthlyUsage\s*:\s*\{[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*resetInSec\s*:\s*(\d+)[^{}]*\}").unwrap(),
            Regex::new(r"(?i)monthlyUsage\s*:\s*\{[^{}]*resetInSec\s*:\s*(\d+)[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*\}").unwrap(),
        ]
    })
}

fn parse_monthly_from_script(html: &str) -> Option<UsagePct> {
    let res = monthly_regexes();
    // pct-first patterns: indices 0, 2
    for (i, re) in res.iter().enumerate() {
        if let Some(caps) = re.captures(html) {
            let (usage_percent, reset_in_sec) = if i % 2 == 0 {
                (
                    caps.get(1)?.as_str().parse().ok()?,
                    caps.get(2)?.as_str().parse().ok()?,
                )
            } else {
                (
                    caps.get(2)?.as_str().parse().ok()?,
                    caps.get(1)?.as_str().parse().ok()?,
                )
            };
            return Some(UsagePct {
                usage_percent,
                reset_in_sec,
            });
        }
    }
    None
}

async fn web_strategy() -> StrategyResult {
    let Some(creds) = resolve_creds() else {
        return Err(StrategyError::unavailable(
            "no OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE",
        ));
    };

    let url = format!(
        "https://opencode.ai/workspace/{}/go",
        urlencoding_encode(&creds.workspace_id)
    );

    let mut headers = HashMap::new();
    headers.insert("Accept", "text/html".into());
    headers.insert("Cookie", format!("auth={}", creds.auth_cookie));
    headers.insert(
        "User-Agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36".into(),
    );

    let resp = http::get(&url, &headers).await.map_err(|e| {
        StrategyError::failed(e, Some("network error".into()), Some(creds.source.clone()))
    })?;

    if resp.status != 200 {
        return Err(StrategyError::failed(
            format!("HTTP {}", resp.status),
            Some("Refresh your OpenCode auth cookie".into()),
            Some(creds.source),
        ));
    }

    let text = html_to_text(&resp.body);
    let rolling = parse_text_window(&text, "Rolling Usage");
    let weekly = parse_text_window(&text, "Weekly Usage");
    let monthly = parse_monthly_from_script(&resp.body)
        .or_else(|| parse_text_window(&text, "Monthly Usage"));

    if rolling.is_none() && weekly.is_none() && monthly.is_none() {
        return Err(StrategyError::failed(
            "Could not parse OpenCode Go usage from dashboard",
            Some("OpenCode may have changed the dashboard markup".into()),
            Some(creds.source),
        ));
    }

    let mut usage = ServiceUsage::ok(SERVICE, &creds.source);
    if let Some(w) = rolling {
        usage.five_hour = Some(
            window_from_reset_secs(w.usage_percent, w.reset_in_sec).with_label("rolling"),
        );
    }
    if let Some(w) = weekly {
        usage.seven_day = Some(
            window_from_reset_secs(w.usage_percent, w.reset_in_sec).with_label("weekly"),
        );
    }
    if let Some(w) = monthly {
        usage.monthly = Some(
            window_from_reset_secs(w.usage_percent, w.reset_in_sec).with_label("monthly"),
        );
    }
    Ok(usage)
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub async fn fetch() -> ServiceUsage {
    let mut pipe = super::strategy::Pipeline::new(
        SERVICE,
        "Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE",
    );
    pipe.push(web_strategy().await);
    pipe.finish()
}
