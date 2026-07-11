//! Provider engine: CodexBar-shaped ordered strategies → ServiceUsage.

mod claude;
mod codex;
mod cursor;
mod http;
mod opencode;
mod strategy;
mod util;

use crate::config;
use crate::types::ServiceUsage;

/// Fetch all providers concurrently (Codex / OpenCode may be N rows).
pub async fn fetch_all() -> Vec<ServiceUsage> {
    let cfg = config::load();
    let (codex_rows, claude, cursor, opencode_rows) = tokio::join!(
        codex::fetch_all_configured(&cfg),
        claude::fetch(),
        cursor::fetch(),
        opencode::fetch_all_configured(&cfg),
    );
    assemble(codex_rows, claude, cursor, opencode_rows)
}

/// Fetch all providers except Claude; inject a precomputed Claude entry (cooldown).
pub async fn fetch_all_skipping_claude(claude: ServiceUsage) -> Vec<ServiceUsage> {
    let cfg = config::load();
    let (codex_rows, cursor, opencode_rows) = tokio::join!(
        codex::fetch_all_configured(&cfg),
        cursor::fetch(),
        opencode::fetch_all_configured(&cfg),
    );
    assemble(codex_rows, claude, cursor, opencode_rows)
}

/// Live-fetch a single service id (does not consult cache / Claude cooldown).
pub async fn fetch_one(service: &str) -> Option<ServiceUsage> {
    let cfg = config::load();
    if service == "claude" {
        return Some(claude::fetch().await);
    }
    if service == "cursor" {
        return Some(cursor::fetch().await);
    }
    if service == "codex" || service.starts_with("codex-") {
        return codex::fetch_one_configured(&cfg, service).await;
    }
    if service == "opencode" || service.starts_with("opencode-") {
        return opencode::fetch_one_configured(&cfg, service).await;
    }
    None
}

fn assemble(
    mut codex_rows: Vec<ServiceUsage>,
    claude: ServiceUsage,
    cursor: ServiceUsage,
    mut opencode_rows: Vec<ServiceUsage>,
) -> Vec<ServiceUsage> {
    if codex_rows.is_empty() {
        codex_rows.push(ServiceUsage::no_credentials(
            "codex",
            "Run 'codex login' or set OPENAI_API_KEY",
        ));
    }
    if opencode_rows.is_empty() {
        opencode_rows.push(ServiceUsage::no_credentials(
            "opencode",
            "Set OpenCode Go in Settings",
        ));
    }
    codex_rows.push(claude);
    codex_rows.push(cursor);
    codex_rows.append(&mut opencode_rows);
    codex_rows
}
