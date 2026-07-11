//! In-memory usage cache: shared TTL + Claude cooldown + singleflight.

use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use crate::providers;
use crate::types::{ServiceStatus, ServiceUsage};

const DEFAULT_TTL_MS: u64 = 60_000;
/// Match JS default: 4 × 5-min browser refresh.
const DEFAULT_CLAUDE_COOLDOWN_MS: u64 = 1_200_000;

fn env_ms(key: &str, default: u64) -> Duration {
    let ms = std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n: &u64| *n > 0)
        .unwrap_or(default);
    Duration::from_millis(ms)
}

struct Inner {
    snapshot: Option<(Instant, Vec<ServiceUsage>)>,
    last_claude_fetch: Option<Instant>,
    last_ok_claude: Option<ServiceUsage>,
}

pub struct UsageCache {
    inner: Mutex<Inner>,
    ttl: Duration,
    claude_cooldown: Duration,
}

impl UsageCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                snapshot: None,
                last_claude_fetch: None,
                last_ok_claude: None,
            }),
            ttl: env_ms("USAGE_CACHE_TTL_MS", DEFAULT_TTL_MS),
            claude_cooldown: env_ms("CLAUDE_FETCH_COOLDOWN_MS", DEFAULT_CLAUDE_COOLDOWN_MS),
        }
    }

    pub async fn invalidate(&self) {
        let mut guard = self.inner.lock().await;
        guard.snapshot = None;
    }

    pub async fn get_all(&self, refresh: bool) -> Vec<ServiceUsage> {
        // Hold the lock for the whole refresh so concurrent callers singleflight.
        let mut guard = self.inner.lock().await;

        if !refresh {
            if let Some((at, entries)) = &guard.snapshot {
                if at.elapsed() < self.ttl {
                    return entries.clone();
                }
            }
        }

        let claude_cached = if claude_in_cooldown(&guard, self.claude_cooldown) {
            Some(claude_cooldown_entry(&guard, self.claude_cooldown))
        } else {
            None
        };

        let entries = if let Some(claude) = claude_cached {
            providers::fetch_all_skipping_claude(claude).await
        } else {
            let live = providers::fetch_all().await;
            if let Some(claude) = live.iter().find(|e| e.service == "claude") {
                note_claude_fetch(&mut guard, claude);
            }
            live
        };

        guard.snapshot = Some((Instant::now(), entries.clone()));
        entries
    }

    pub async fn get_one(&self, service: &str, refresh: bool) -> Option<ServiceUsage> {
        if !refresh {
            return self
                .get_all(false)
                .await
                .into_iter()
                .find(|e| e.service == service);
        }

        let mut guard = self.inner.lock().await;

        if service == "claude" && claude_in_cooldown(&guard, self.claude_cooldown) {
            let entry = claude_cooldown_entry(&guard, self.claude_cooldown);
            patch_snapshot(&mut guard, entry.clone());
            return Some(entry);
        }

        let entry = providers::fetch_one(service).await?;
        if service == "claude" {
            note_claude_fetch(&mut guard, &entry);
        }
        patch_snapshot(&mut guard, entry.clone());
        Some(entry)
    }
}

fn note_claude_fetch(inner: &mut Inner, claude: &ServiceUsage) {
    // Only start cooldown after a live attempt (creds existed / API hit).
    if claude.status != ServiceStatus::NoCredentials {
        inner.last_claude_fetch = Some(Instant::now());
    }
    if claude.status == ServiceStatus::Ok {
        inner.last_ok_claude = Some(claude.clone());
    }
}

/// Replace or insert one row in the cached snapshot without resetting TTL.
fn patch_snapshot(inner: &mut Inner, entry: ServiceUsage) {
    if let Some((_, entries)) = &mut inner.snapshot {
        if let Some(slot) = entries.iter_mut().find(|e| e.service == entry.service) {
            *slot = entry;
        } else {
            entries.push(entry);
        }
    }
}

fn claude_in_cooldown(inner: &Inner, cooldown: Duration) -> bool {
    inner
        .last_claude_fetch
        .map(|t| t.elapsed() < cooldown)
        .unwrap_or(false)
}

fn claude_cooldown_entry(inner: &Inner, cooldown: Duration) -> ServiceUsage {
    if let Some(ok) = &inner.last_ok_claude {
        return ok.clone();
    }
    let remaining = inner
        .last_claude_fetch
        .map(|t| cooldown.saturating_sub(t.elapsed()))
        .unwrap_or(cooldown);
    let mins = remaining.as_secs().div_ceil(60).max(1);
    ServiceUsage {
        service: "claude".into(),
        status: ServiceStatus::Throttled,
        error: Some("Rate limited".into()),
        hint: Some(format!(
            "Skipped: retry in ~{mins} min (cooldown to avoid 429)"
        )),
        five_hour: None,
        seven_day: None,
        monthly: None,
        plan: None,
        source: None,
        display_name: None,
        account_email: None,
    }
}
