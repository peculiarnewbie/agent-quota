//! Shared helpers for provider strategies.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::types::UsageWindow;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn format_duration_seconds(total_seconds: i64) -> String {
    if total_seconds <= 0 {
        return "Now".into();
    }
    let days = total_seconds / 86400;
    let hours = (total_seconds % 86400) / 3600;
    let minutes = (total_seconds % 3600) / 60;
    if days > 0 {
        format!("{days}d {hours}h {minutes}m")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

pub fn format_reset_iso(iso: &str) -> (String, u64) {
    match OffsetDateTime::parse(iso, &Rfc3339) {
        Ok(dt) => {
            let resets_at_ms = (dt.unix_timestamp() as u64).saturating_mul(1000);
            let now = now_ms() as i64;
            let delta = (resets_at_ms as i64 - now) / 1000;
            (format_duration_seconds(delta), resets_at_ms)
        }
        Err(_) => (iso.chars().take(19).collect(), 0),
    }
}

pub fn window_from_reset_secs(used_percent: f64, reset_secs: i64) -> UsageWindow {
    let resets_at_ms = now_ms().saturating_add((reset_secs.max(0) as u64) * 1000);
    UsageWindow::from_percent(
        used_percent,
        format_duration_seconds(reset_secs),
        resets_at_ms,
    )
}

pub fn window_from_iso(used_percent: f64, resets_at: Option<&str>) -> UsageWindow {
    match resets_at {
        Some(iso) => {
            let (resets_in, resets_at_ms) = format_reset_iso(iso);
            UsageWindow::from_percent(used_percent, resets_in, resets_at_ms)
        }
        None => UsageWindow::from_percent(used_percent, "N/A".into(), 0),
    }
}

pub fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

pub fn read_json_file(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
