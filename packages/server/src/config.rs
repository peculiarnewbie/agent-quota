//! Persistent settings at `~/.config/agent-quota/config.json` (mode 0600).

use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Legacy single OpenCode Go entry — migrated into [`Self::opencode_go_accounts`] on load/save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opencode_go: Option<OpencodeGoConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opencode_go_accounts: Vec<OpencodeGoAccountConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub codex_accounts: Vec<CodexAccountConfig>,
}

fn default_version() -> u32 {
    CONFIG_VERSION
}

/// Legacy single-account shape (still accepted when reading old config files).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_cookie: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoAccountConfig {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_cookie: Option<String>,
}

impl OpencodeGoAccountConfig {
    pub fn service_id(&self) -> String {
        if self.id == "opencode" {
            "opencode".into()
        } else if self.id.starts_with("opencode-") {
            self.id.clone()
        } else {
            format!("opencode-{}", self.id)
        }
    }

}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountConfig {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Primary dashboard row (`service: "codex"`). Falls back to `~/.codex` when `authJson` is unset.
    #[serde(default, skip_serializing_if = "is_false")]
    pub local: bool,
    /// Path to a Codex CLI `auth.json`. When set, used instead of `~/.codex` (including for local).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_json: Option<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
}

impl CodexAccountConfig {
    pub fn is_local_default(&self) -> bool {
        self.local || self.id == "codex"
    }

    /// Explicit `authJson` path, if configured.
    pub fn auth_json_path(&self) -> Option<&str> {
        self.auth_json
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }

    pub fn service_id(&self) -> String {
        if self.is_local_default() {
            "codex".into()
        } else if self.id.starts_with("codex-") {
            self.id.clone()
        } else {
            format!("codex-{}", self.id)
        }
    }
}

/// Public GET /api/settings payload (secrets masked).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPublic {
    pub opencode_go_accounts: Vec<OpencodeGoAccountPublic>,
    pub codex_accounts: Vec<CodexAccountPublic>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoAccountPublic {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_cookie_masked: Option<String>,
    pub has_cookie: bool,
    pub service: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountPublic {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub local: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_json: Option<String>,
    pub service: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeAccountsPutBody {
    pub accounts: Vec<OpencodeAccountPut>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeAccountPut {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Empty / omitted → leave previous cookie for this id unchanged.
    #[serde(default)]
    pub auth_cookie: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountsPutBody {
    pub accounts: Vec<CodexAccountPut>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountPut {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub local: bool,
    #[serde(default)]
    pub auth_json: Option<String>,
}

pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config").join("agent-quota").join("config.json"))
}

/// Normalize legacy `opencodeGo` into `opencodeGoAccounts`.
pub fn normalize(cfg: &mut AppConfig) {
    if cfg.opencode_go_accounts.is_empty() {
        if let Some(og) = cfg.opencode_go.take() {
            let ws = og
                .workspace_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let cookie = og
                .auth_cookie
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            if ws.is_some() || cookie.is_some() {
                cfg.opencode_go_accounts.push(OpencodeGoAccountConfig {
                    id: "opencode".into(),
                    label: None,
                    workspace_id: ws,
                    auth_cookie: cookie,
                });
            }
        }
    } else {
        // Drop legacy field once list exists.
        cfg.opencode_go = None;
    }
}

pub fn load() -> AppConfig {
    let Some(path) = config_path() else {
        return AppConfig::default();
    };
    load_from(&path)
}

pub fn load_from(path: &Path) -> AppConfig {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<AppConfig>(&text) {
            Ok(mut cfg) => {
                if cfg.version == 0 {
                    cfg.version = CONFIG_VERSION;
                }
                normalize(&mut cfg);
                cfg
            }
            Err(e) => {
                eprintln!("[config] failed to parse {}: {e}", path.display());
                AppConfig::default()
            }
        },
        Err(_) => AppConfig::default(),
    }
}

pub fn save(cfg: &AppConfig) -> Result<PathBuf, String> {
    let path = config_path().ok_or_else(|| "HOME not set".to_string())?;
    save_to(&path, cfg)?;
    Ok(path)
}

pub fn save_to(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    let mut out = cfg.clone();
    out.version = CONFIG_VERSION;
    normalize(&mut out);
    // Never rewrite legacy single field.
    out.opencode_go = None;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        #[cfg(unix)]
        {
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }

    let json = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");

    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut file = opts
            .open(&tmp)
            .map_err(|e| format!("open {}: {e}", tmp.display()))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("sync {}: {e}", tmp.display()))?;
    }

    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }

    fs::rename(&tmp, path).map_err(|e| format!("rename {}: {e}", path.display()))?;
    Ok(())
}

pub fn mask_cookie(cookie: &str) -> String {
    let trimmed = cookie.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.len() <= 4 {
        return "****".into();
    }
    format!("****{}", &trimmed[trimmed.len() - 4..])
}

pub fn to_public(cfg: &AppConfig) -> SettingsPublic {
    let path = config_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "~/.config/agent-quota/config.json".into());

    let opencode_go_accounts = if cfg.opencode_go_accounts.is_empty() {
        Vec::new()
    } else {
        cfg.opencode_go_accounts
            .iter()
            .map(|a| {
                let cookie = a
                    .auth_cookie
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                OpencodeGoAccountPublic {
                    id: a.id.clone(),
                    label: a.label.clone(),
                    workspace_id: a
                        .workspace_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string()),
                    auth_cookie_masked: cookie.map(mask_cookie),
                    has_cookie: cookie.is_some(),
                    service: a.service_id(),
                }
            })
            .collect()
    };

    let codex_accounts = if cfg.codex_accounts.is_empty() {
        vec![CodexAccountPublic {
            id: "codex".into(),
            label: None,
            local: true,
            auth_json: None,
            service: "codex".into(),
        }]
    } else {
        cfg.codex_accounts
            .iter()
            .map(|a| CodexAccountPublic {
                id: a.id.clone(),
                label: a.label.clone(),
                local: a.is_local_default(),
                auth_json: a.auth_json.clone(),
                service: a.service_id(),
            })
            .collect()
    };

    SettingsPublic {
        opencode_go_accounts,
        codex_accounts,
        config_path: path,
    }
}

fn is_valid_slug(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Replace the full OpenCode Go account list.
pub fn apply_opencode_accounts(
    cfg: &mut AppConfig,
    body: OpencodeAccountsPutBody,
) -> Result<(), String> {
    let prev: std::collections::HashMap<String, OpencodeGoAccountConfig> = cfg
        .opencode_go_accounts
        .iter()
        .cloned()
        .map(|a| (a.id.clone(), a))
        .collect();

    if body.accounts.is_empty() {
        cfg.opencode_go_accounts.clear();
        cfg.opencode_go = None;
        return Ok(());
    }

    let mut out: Vec<OpencodeGoAccountConfig> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for raw in body.accounts {
        let id = raw.id.trim().to_string();
        if !is_valid_slug(&id) {
            return Err(format!(
                "invalid opencode id '{id}' (use letters, digits, -, _)"
            ));
        }
        if !seen.insert(id.clone()) {
            return Err(format!("duplicate opencode id: {id}"));
        }

        let label = raw
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let workspace_id = raw
            .workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let prev_cookie = prev.get(&id).and_then(|a| a.auth_cookie.clone());
        let auth_cookie = match raw.auth_cookie {
            Some(c) => {
                let trimmed = c.trim().to_string();
                if trimmed.is_empty() {
                    prev_cookie
                } else {
                    Some(trimmed)
                }
            }
            None => prev_cookie,
        };

        if workspace_id.is_none() {
            return Err(format!("opencode account '{id}' needs workspaceId"));
        }

        out.push(OpencodeGoAccountConfig {
            id,
            label,
            workspace_id,
            auth_cookie,
        });
    }

    cfg.opencode_go_accounts = out;
    cfg.opencode_go = None;
    Ok(())
}

/// Replace the full Codex account list (local + authJson extras).
pub fn apply_codex_accounts(
    cfg: &mut AppConfig,
    body: CodexAccountsPutBody,
) -> Result<(), String> {
    if body.accounts.is_empty() {
        cfg.codex_accounts.clear();
        return Ok(());
    }

    let mut out: Vec<CodexAccountConfig> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut local_count = 0usize;

    for raw in body.accounts {
        let id = raw.id.trim().to_string();
        if !is_valid_slug(&id) {
            return Err(format!(
                "invalid codex id '{id}' (use letters, digits, -, _)"
            ));
        }
        if !seen.insert(id.clone()) {
            return Err(format!("duplicate codex id: {id}"));
        }

        let label = raw
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let auth_json = raw
            .auth_json
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let local = raw.local || id == "codex";
        if local {
            local_count += 1;
            if id != "codex" {
                return Err("local Codex account id must be \"codex\"".into());
            }
            out.push(CodexAccountConfig {
                id: "codex".into(),
                label,
                local: true,
                auth_json,
            });
        } else {
            if id == "codex" {
                return Err("extra Codex accounts need an id other than \"codex\"".into());
            }
            let Some(auth_json) = auth_json else {
                return Err(format!("codex account '{id}' needs authJson path"));
            };
            out.push(CodexAccountConfig {
                id,
                label,
                local: false,
                auth_json: Some(auth_json),
            });
        }
    }

    if local_count > 1 {
        return Err("only one local Codex account is allowed".into());
    }
    if local_count == 0 {
        out.insert(
            0,
            CodexAccountConfig {
                id: "codex".into(),
                label: None,
                local: true,
                auth_json: None,
            },
        );
    }

    cfg.codex_accounts = out;
    Ok(())
}
