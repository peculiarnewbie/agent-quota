//! Provider engine: CodexBar-shaped ordered strategies → ServiceUsage.

mod claude;
mod codex;
mod cursor;
mod http;
mod opencode;
mod strategy;
mod util;

use crate::types::{ServiceUsage, V1_SERVICES};

fn order_v1(
    codex: ServiceUsage,
    claude: ServiceUsage,
    cursor: ServiceUsage,
    opencode: ServiceUsage,
) -> Vec<ServiceUsage> {
    let mut by_id = std::collections::HashMap::new();
    by_id.insert("codex", codex);
    by_id.insert("claude", claude);
    by_id.insert("cursor", cursor);
    by_id.insert("opencode", opencode);

    V1_SERVICES
        .iter()
        .filter_map(|id| by_id.remove(*id))
        .collect()
}

/// Fetch all v1 providers concurrently.
pub async fn fetch_all() -> Vec<ServiceUsage> {
    let (codex, claude, cursor, opencode) =
        tokio::join!(codex::fetch(), claude::fetch(), cursor::fetch(), opencode::fetch());
    order_v1(codex, claude, cursor, opencode)
}

/// Fetch all providers except Claude; inject a precomputed Claude entry (cooldown).
pub async fn fetch_all_skipping_claude(claude: ServiceUsage) -> Vec<ServiceUsage> {
    let (codex, cursor, opencode) =
        tokio::join!(codex::fetch(), cursor::fetch(), opencode::fetch());
    order_v1(codex, claude, cursor, opencode)
}

