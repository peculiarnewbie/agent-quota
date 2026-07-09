mod cache;
mod providers;
mod types;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{Request, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde::Deserialize;

use cache::UsageCache;
use types::{HealthResponse, ServiceStatus, ServiceUsage, V1_SERVICES};

struct AppState {
    static_dir: Option<PathBuf>,
    cache: UsageCache,
}

struct CliArgs {
    port: u16,
    static_dir: Option<String>,
    bind: String,
}

#[derive(Debug, Deserialize)]
struct UsageQuery {
    /// Bypass TTL when `1` / `true` / `yes`. Claude cooldown still applies.
    refresh: Option<String>,
}

impl UsageQuery {
    fn refresh(&self) -> bool {
        matches!(
            self.refresh.as_deref().map(|s| s.trim().to_ascii_lowercase()),
            Some(s) if s == "1" || s == "true" || s == "yes"
        )
    }
}

fn parse_args() -> CliArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut port = 6767u16;
    let mut static_dir = None;
    let mut bind = "0.0.0.0".to_string();

    let mut i = 1;
    while i < args.len() {
        let (flag, inline_value) = if let Some(idx) = args[i].find('=') {
            let (k, v) = args[i].split_at(idx);
            (k.to_string(), Some(v[1..].to_string()))
        } else {
            (args[i].clone(), None)
        };
        let value_from_next: Option<String> = if inline_value.is_none() {
            args.get(i + 1).cloned()
        } else {
            None
        };
        let consumed_next = inline_value.is_none() && value_from_next.is_some();
        match flag.as_str() {
            "--port" => {
                if let Some(v) = inline_value.or(value_from_next) {
                    port = v.parse().unwrap_or(6767);
                }
            }
            "--static" => {
                if let Some(v) = inline_value.or(value_from_next) {
                    static_dir = Some(v);
                }
            }
            "--bind" => {
                if let Some(v) = inline_value.or(value_from_next) {
                    bind = v;
                }
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            _ => {}
        }
        if consumed_next {
            i += 2;
        } else {
            i += 1;
        }
    }

    if let Ok(v) = std::env::var("PORT") {
        if let Ok(p) = v.parse() {
            port = p;
        }
    }
    if let Ok(v) = std::env::var("STATIC_DIR") {
        static_dir = Some(v);
    }
    if let Ok(v) = std::env::var("BIND") {
        bind = v;
    }

    CliArgs {
        port,
        static_dir,
        bind,
    }
}

fn print_help() {
    println!(
        "agent-quota — AI coding assistant usage dashboard

Usage: agent-quota [OPTIONS]

Options:
  --port <PORT>      Listen port (default: 6767, env: PORT)
  --bind <ADDR>      Bind address (default: 0.0.0.0, env: BIND)
  --static <DIR>     Static UI directory (env: STATIC_DIR)
  -h, --help         Show this help

Env:
  USAGE_CACHE_TTL_MS           Snapshot TTL ms (default: 60000)
  CLAUDE_FETCH_COOLDOWN_MS     Claude live-fetch cooldown (default: 1200000)
  USAGE_HTTP_TIMEOUT_MS        Provider HTTP timeout (default: 8000)

API:
  GET /api/usage?refresh=1     Bypass TTL (Claude cooldown still applies)
"
    );
}

fn resolve_static_dir(cli_static: &Option<String>) -> Option<PathBuf> {
    if let Some(d) = cli_static {
        let p = PathBuf::from(d);
        if p.join("index.html").exists() {
            return Some(p);
        }
        eprintln!("warning: --static {} has no index.html", d);
    }

    let candidates = [
        PathBuf::from("packages/web/dist"),
        PathBuf::from("../web/dist"),
        PathBuf::from("../../web/dist"),
        PathBuf::from("public"),
    ];
    for c in candidates {
        if c.join("index.html").exists() {
            return Some(c);
        }
    }
    None
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    if let Err(err) = run_server(args).await {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

async fn run_server(args: CliArgs) -> Result<(), Box<dyn std::error::Error>> {
    let static_dir = resolve_static_dir(&args.static_dir);
    if let Some(ref d) = static_dir {
        println!("Serving static files from {}", d.display());
    } else {
        println!("No static directory found, running API-only mode");
    }

    let state = Arc::new(AppState {
        static_dir,
        cache: UsageCache::new(),
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/usage", get(usage_handler))
        .route("/api/usage/{service}", get(usage_service_handler))
        .fallback(get(static_handler))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", args.bind, args.port).parse()?;
    println!("Starting agent-quota on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn usage_handler(
    State(state): State<Arc<AppState>>,
    Query(q): Query<UsageQuery>,
) -> Json<Vec<ServiceUsage>> {
    Json(state.cache.get_all(q.refresh()).await)
}

async fn usage_service_handler(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(service): axum::extract::Path<String>,
    Query(q): Query<UsageQuery>,
) -> impl IntoResponse {
    if !V1_SERVICES.contains(&service.as_str()) {
        return (
            StatusCode::NOT_FOUND,
            Json(ServiceUsage::error(service, "unknown service")),
        )
            .into_response();
    }

    match state.cache.get_one(&service, q.refresh()).await {
        Some(entry) => {
            debug_assert!(
                entry.status != ServiceStatus::Ok || entry.source.is_some(),
                "ok responses must include source"
            );
            (StatusCode::OK, Json(entry)).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(ServiceUsage::error(service, "unknown service")),
        )
            .into_response(),
    }
}

async fn static_handler(State(state): State<Arc<AppState>>, req: Request<Body>) -> Response<Body> {
    let path = req.uri().path();

    let static_dir = match &state.static_dir {
        Some(d) => d,
        None => {
            return Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"status":"agent-quota API server"}"#))
                .unwrap();
        }
    };

    let rel = path.trim_start_matches('/');
    let file_path = if rel.is_empty() {
        static_dir.join("index.html")
    } else {
        static_dir.join(rel)
    };

    if !file_path.starts_with(static_dir) {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::from("Forbidden"))
            .unwrap();
    }

    if file_path.exists() && file_path.is_file() {
        match tokio::fs::read(&file_path).await {
            Ok(content) => Response::builder()
                .status(StatusCode::OK)
                .header("content-type", mime_from_path(&file_path))
                .body(Body::from(content))
                .unwrap(),
            Err(_) => serve_index(static_dir).await,
        }
    } else {
        serve_index(static_dir).await
    }
}

async fn serve_index(static_dir: &Path) -> Response<Body> {
    let index = static_dir.join("index.html");
    match tokio::fs::read(&index).await {
        Ok(content) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html; charset=utf-8")
            .body(Body::from(content))
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap(),
    }
}

fn mime_from_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "webp" => "image/webp",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
