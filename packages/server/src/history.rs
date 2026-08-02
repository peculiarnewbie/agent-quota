//! Persistent provider usage history sampled by the background collector.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use tokio::sync::watch;

use crate::types::{ServiceStatus, ServiceUsage, UsageHistoryPoint, UsageHistoryResponse};

const DEFAULT_RETENTION_DAYS: u64 = 90;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const MINUTE_MS: u64 = 60 * 1000;

#[derive(Clone)]
pub struct HistoryStore {
    path: Arc<PathBuf>,
    retention: Duration,
    interval_ms: watch::Sender<u64>,
}

#[derive(Debug, Clone)]
struct HistorySample {
    service: String,
    window_kind: String,
    used_percent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowKind {
    Weekly,
    Monthly,
}

impl WindowKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }
}

impl HistoryStore {
    pub fn open(interval_ms: u64) -> Result<Self, String> {
        let path = history_path()?;
        ensure_parent(&path)?;
        let _ = open_connection(&path)?;
        set_private_permissions(&path);
        let (interval_ms, _) = watch::channel(interval_ms.max(1));

        Ok(Self {
            path: Arc::new(path),
            retention: retention_duration(),
            interval_ms,
        })
    }

    pub fn sample_interval(&self) -> Duration {
        Duration::from_millis(*self.interval_ms.borrow())
    }

    pub fn sample_interval_minutes(&self) -> u64 {
        (*self.interval_ms.borrow()).div_ceil(MINUTE_MS).max(1)
    }

    pub fn set_interval_ms(&self, interval_ms: u64) {
        self.interval_ms.send_replace(interval_ms.max(1));
    }

    pub fn subscribe_interval(&self) -> watch::Receiver<u64> {
        self.interval_ms.subscribe()
    }

    pub async fn record_snapshot(&self, entries: &[ServiceUsage]) -> Result<(), String> {
        let samples: Vec<HistorySample> = entries.iter().filter_map(history_sample).collect();
        if samples.is_empty() {
            return Ok(());
        }

        let path = Arc::clone(&self.path);
        let retention_ms = self.retention.as_millis().min(i64::MAX as u128) as u64;
        tokio::task::spawn_blocking(move || {
            record_snapshot_sync(&path, &samples, now_ms(), retention_ms)
        })
        .await
        .map_err(|e| format!("history writer task failed: {e}"))?
    }

    pub async fn get(&self, service: &str, days: u32) -> Result<UsageHistoryResponse, String> {
        let path = Arc::clone(&self.path);
        let service = service.to_string();
        let cutoff_ms = now_ms().saturating_sub(u64::from(days) * DAY_MS);
        let sample_interval_minutes = self.sample_interval_minutes();
        tokio::task::spawn_blocking(move || {
            query_history_sync(
                &path,
                &service,
                cutoff_ms,
                sample_interval_minutes,
            )
        })
            .await
            .map_err(|e| format!("history reader task failed: {e}"))?
    }
}

fn history_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("USAGE_HISTORY_DB") {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            return Err("USAGE_HISTORY_DB cannot be empty".into());
        }
        return Ok(path);
    }

    dirs::home_dir()
        .map(|home| {
            home.join(".config")
                .join("agent-quota")
                .join("usage-history.sqlite3")
        })
        .ok_or_else(|| "HOME not set; cannot locate usage history database".into())
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    Ok(())
}

fn set_private_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path)
        .map_err(|e| format!("open history database {}: {e}", path.display()))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("configure history database: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS usage_history (
             service TEXT NOT NULL,
             window_kind TEXT NOT NULL,
             sampled_at_ms INTEGER NOT NULL,
             used_percent REAL NOT NULL,
             delta_percent REAL NOT NULL,
             reset INTEGER NOT NULL,
             PRIMARY KEY (service, window_kind, sampled_at_ms)
         );
         CREATE INDEX IF NOT EXISTS idx_usage_history_lookup
             ON usage_history (service, sampled_at_ms);
        ",
    )
    .map_err(|e| format!("initialize history database: {e}"))?;
    Ok(conn)
}

fn history_sample(entry: &ServiceUsage) -> Option<HistorySample> {
    if entry.status != ServiceStatus::Ok {
        return None;
    }

    if let Some(window) = entry.seven_day.as_ref() {
        let is_credit_balance = window
            .label
            .as_deref()
            .map(|label| {
                let label = label.trim();
                label.eq_ignore_ascii_case("credit") || label.eq_ignore_ascii_case("credits")
            })
            .unwrap_or(false);
        if !is_credit_balance {
            return Some(HistorySample {
                service: entry.service.clone(),
                window_kind: WindowKind::Weekly.as_str().into(),
                used_percent: window.used_percent,
            });
        }
    }

    entry.monthly.as_ref().map(|window| HistorySample {
        service: entry.service.clone(),
        window_kind: WindowKind::Monthly.as_str().into(),
        used_percent: window.used_percent,
    })
}

fn delta_for(previous: Option<f64>, current: f64) -> (f64, bool) {
    match previous {
        None => (0.0, false),
        Some(previous) if current < previous => (current, true),
        Some(previous) => ((current - previous).max(0.0), false),
    }
}

fn record_snapshot_sync(
    path: &Path,
    samples: &[HistorySample],
    sampled_at_ms: u64,
    retention_ms: u64,
) -> Result<(), String> {
    let mut conn = open_connection(path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("begin history transaction: {e}"))?;

    for sample in samples {
        let previous: Option<f64> = tx
            .query_row(
                "SELECT used_percent
                 FROM usage_history
                 WHERE service = ?1 AND window_kind = ?2
                 ORDER BY sampled_at_ms DESC
                 LIMIT 1",
                params![sample.service, sample.window_kind],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("read previous history point: {e}"))?;
        let (delta_percent, reset) = delta_for(previous, sample.used_percent);

        tx.execute(
            "INSERT OR REPLACE INTO usage_history
             (service, window_kind, sampled_at_ms, used_percent, delta_percent, reset)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                sample.service,
                sample.window_kind,
                sampled_at_ms as i64,
                sample.used_percent,
                delta_percent,
                if reset { 1 } else { 0 },
            ],
        )
        .map_err(|e| format!("write history point: {e}"))?;
    }

    let cutoff_ms = sampled_at_ms.saturating_sub(retention_ms) as i64;
    tx.execute(
        "DELETE FROM usage_history WHERE sampled_at_ms < ?1",
        params![cutoff_ms],
    )
    .map_err(|e| format!("prune history points: {e}"))?;

    tx.commit()
        .map_err(|e| format!("commit history transaction: {e}"))
}

fn query_history_sync(
    path: &Path,
    service: &str,
    cutoff_ms: u64,
    sample_interval_minutes: u64,
) -> Result<UsageHistoryResponse, String> {
    let conn = open_connection(path)?;
    let window: Option<String> = conn
        .query_row(
            "SELECT window_kind
             FROM usage_history
             WHERE service = ?1
             ORDER BY sampled_at_ms DESC
             LIMIT 1",
            params![service],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("read history window: {e}"))?;

    let Some(window) = window else {
        return Ok(UsageHistoryResponse {
            service: service.into(),
            window: None,
            sample_interval_minutes,
            points: Vec::new(),
        });
    };

    let mut stmt = conn
        .prepare(
            "SELECT sampled_at_ms, used_percent, delta_percent, reset
             FROM usage_history
             WHERE service = ?1 AND window_kind = ?2 AND sampled_at_ms >= ?3
             ORDER BY sampled_at_ms ASC",
        )
        .map_err(|e| format!("prepare history query: {e}"))?;
    let rows = stmt
        .query_map(params![service, window, cutoff_ms as i64], |row| {
            Ok(UsageHistoryPoint {
                sampled_at_ms: row.get::<_, i64>(0)? as u64,
                used_percent: row.get(1)?,
                delta_percent: row.get(2)?,
                reset: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| format!("query history points: {e}"))?;

    let mut points = Vec::new();
    for row in rows {
        points.push(row.map_err(|e| format!("read history point: {e}"))?);
    }

    Ok(UsageHistoryResponse {
        service: service.into(),
        window: Some(window),
        sample_interval_minutes,
        points,
    })
}

fn retention_duration() -> Duration {
    let days = std::env::var("USAGE_HISTORY_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|days| *days > 0)
        .unwrap_or(DEFAULT_RETENTION_DAYS);
    Duration::from_secs(days.saturating_mul(24 * 60 * 60))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::UsageWindow;

    #[test]
    fn prefers_weekly_over_monthly_and_skips_credit_balance() {
        let mut weekly = ServiceUsage::ok("opencode", "test");
        weekly.seven_day = Some(UsageWindow::from_percent(12.0, "1d".into(), 0));
        weekly.monthly = Some(UsageWindow::from_percent(42.0, "2d".into(), 0));
        assert_eq!(history_sample(&weekly).unwrap().window_kind, "weekly");

        let mut cursor = ServiceUsage::ok("cursor", "test");
        cursor.seven_day =
            Some(UsageWindow::from_percent(75.0, "--".into(), 0).with_label("credits"));
        cursor.monthly = Some(UsageWindow::from_percent(42.0, "2d".into(), 0));
        let sample = history_sample(&cursor).unwrap();
        assert_eq!(sample.window_kind, "monthly");
        assert_eq!(sample.used_percent, 42.0);
    }

    #[test]
    fn reset_delta_starts_again_at_current_usage() {
        assert_eq!(delta_for(Some(80.0), 12.0), (12.0, true));
        assert_eq!(delta_for(Some(12.0), 18.0), (6.0, false));
        assert_eq!(delta_for(None, 18.0), (0.0, false));
    }

    #[test]
    fn persists_and_reads_history_deltas() {
        let path = std::env::temp_dir().join(format!(
            "agent-quota-history-{}-{}.sqlite3",
            std::process::id(),
            now_ms()
        ));

        let mut first = ServiceUsage::ok("codex", "test");
        first.seven_day = Some(UsageWindow::from_percent(10.0, "1d".into(), 0));
        let mut second = ServiceUsage::ok("codex", "test");
        second.seven_day = Some(UsageWindow::from_percent(18.5, "1d".into(), 0));

        let samples = [history_sample(&first).unwrap()];
        record_snapshot_sync(&path, &samples, 1_000, u64::MAX).unwrap();
        let samples = [history_sample(&second).unwrap()];
        record_snapshot_sync(&path, &samples, 2_000, u64::MAX).unwrap();

        let response = query_history_sync(&path, "codex", 0, 15).unwrap();
        assert_eq!(response.window.as_deref(), Some("weekly"));
        assert_eq!(response.points.len(), 2);
        assert_eq!(response.points[0].delta_percent, 0.0);
        assert_eq!(response.points[1].delta_percent, 8.5);
        assert!(!response.points[1].reset);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
