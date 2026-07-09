//! Shared HTTP helpers for provider strategies.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value;

const DEFAULT_TIMEOUT_MS: u64 = 8000;

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let timeout_ms = std::env::var("USAGE_HTTP_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent("agent-quota/0.1")
            .build()
            .expect("failed to build HTTP client")
    })
}

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn json(&self) -> Option<Value> {
        serde_json::from_str(&self.body).ok()
    }

    pub fn truncate_hint(&self, max: usize) -> String {
        let cleaned = self.body.split_whitespace().collect::<Vec<_>>().join(" ");
        if cleaned.len() <= max {
            cleaned
        } else {
            format!("{}…", &cleaned[..max])
        }
    }
}

fn headers_from_map(headers: &HashMap<&str, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(v).map_err(|e| e.to_string())?;
        map.insert(name, value);
    }
    Ok(map)
}

pub async fn get(url: &str, headers: &HashMap<&str, String>) -> Result<HttpResponse, String> {
    let map = headers_from_map(headers)?;
    let resp = client()
        .get(url)
        .headers(map)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}

pub async fn post_json(
    url: &str,
    headers: &HashMap<&str, String>,
    body: &Value,
) -> Result<HttpResponse, String> {
    let map = headers_from_map(headers)?;
    let resp = client()
        .post(url)
        .headers(map)
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}
