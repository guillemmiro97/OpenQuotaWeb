//! Headless web server for OpenQuota.
//!
//! Reuses the same provider registry, storage and settings services as the
//! desktop app and exposes them over HTTP + SSE, serving the Svelte UI as
//! static files.

pub mod events;
pub mod paths;
pub mod routes;
pub mod secrets;
pub mod state;

use std::sync::Arc;

use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};
use tower_http::services::{ServeDir, ServeFile};

use crate::models::LogLevel;

fn set_default(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        std::env::set_var(name, value);
    }
}

fn ensure_environment_defaults() {
    set_default("HOME", "/data/home");
    set_default("XDG_DATA_HOME", "/data/xdg-data");
    set_default("XDG_CONFIG_HOME", "/config");
    set_default("XDG_STATE_HOME", "/data/xdg-state");
    set_default("XDG_CACHE_HOME", "/data/xdg-cache");
}

/// Create the persistent directories the provider integrations expect, so
/// credential imports and host mounts land in the right place.
fn ensure_directories() {
    for key in [
        "HOME",
        "XDG_DATA_HOME",
        "XDG_CONFIG_HOME",
        "XDG_STATE_HOME",
        "XDG_CACHE_HOME",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "OPENCODE_DATA_DIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            let _ = std::fs::create_dir_all(value);
        }
    }
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    ensure_environment_defaults();
    ensure_directories();
    crate::logging::enable_console_output();
    crate::logging::init(crate::logging::default_log_path(), LogLevel::Info);

    let host = std::env::var("OPENQUOTA_HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
    let port: u16 = std::env::var("OPENQUOTA_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let static_dir =
        std::env::var("OPENQUOTA_STATIC_DIR").unwrap_or_else(|_| "/app/dist".to_owned());

    let init = state::initialize()?;
    let state = init.state.clone();

    crate::app_info!(
        "config",
        "OpenQuota web server starting (version={})",
        env!("CARGO_PKG_VERSION")
    );

    // Non-blocking startup credential detection, mirroring the desktop app.
    {
        let startup_state = state.clone();
        let plan = init.detection_plan;
        crate::runtime::spawn(async move {
            let detected = crate::providers::detect_local_credentials(
                startup_state.registry.clone(),
                plan.provider_ids(),
            )
            .await;
            let command_guard = startup_state.settings.lock_command_mutation().await;
            let outcome = startup_state
                .settings
                .apply_credential_detection(&plan, &detected);
            match outcome {
                Ok(outcome) => {
                    events::emit(
                        &startup_state.events,
                        "settings-state",
                        &routes::view_state(&startup_state),
                    );
                    let provider_ids = outcome.newly_enabled_provider_ids;
                    drop(command_guard);
                    if !provider_ids.is_empty() {
                        routes::refresh_providers(&startup_state, &provider_ids).await;
                    }
                }
                Err(_) => {
                    crate::app_warn!(
                        "config",
                        "startup credential detection could not be applied"
                    );
                    drop(command_guard);
                }
            }
        });
    }

    // Periodic background refresh.
    {
        let loop_state = state.clone();
        crate::runtime::spawn(async move {
            loop {
                let provider_ids = loop_state.settings.enabled_provider_ids();
                if !provider_ids.is_empty() {
                    routes::refresh_providers(&loop_state, &provider_ids).await;
                }
                tokio::time::sleep(crate::policy::REFRESH_INTERVAL).await;
            }
        });
    }

    let index_file = format!("{static_dir}/index.html");
    let static_files = ServeDir::new(&static_dir).fallback(ServeFile::new(index_file));

    let app = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/bootstrap", get(routes::get_bootstrap))
        .route(
            "/api/settings",
            get(routes::get_settings).put(routes::save_settings),
        )
        .route(
            "/api/settings/reset-customization",
            post(routes::reset_customization),
        )
        .route("/api/settings/reset-all", post(routes::reset_all_settings))
        .route(
            "/api/settings/reset-provider/{provider_id}",
            post(routes::reset_provider),
        )
        .route("/api/usage/refresh", post(routes::refresh_usage))
        .route(
            "/api/usage/refresh/{provider_id}",
            post(routes::refresh_provider),
        )
        .route("/api/codex/reset-claim", post(routes::claim_codex_reset))
        .route(
            "/api/providers/{provider_id}/api-key",
            get(routes::get_api_key)
                .put(routes::save_api_key)
                .delete(routes::delete_api_key),
        )
        .route(
            "/api/providers/{provider_id}/links/{link_index}",
            get(routes::get_provider_link),
        )
        .route(
            "/api/providers/{provider_id}/credentials",
            put(routes::save_provider_credentials),
        )
        .route(
            "/api/notifications/permission",
            post(routes::request_notification_permission),
        )
        .route("/api/logs/path", get(routes::get_log_path))
        .route("/api/updates", get(routes::get_updates))
        .route("/api/events", get(routes::events_stream))
        .fallback_service(static_files)
        .layer(middleware::from_fn(routes::require_auth))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    crate::app_info!("config", "OpenQuota web server listening on {host}:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Convenience alias used by the binary entry point.
pub type SharedState = Arc<state::AppState>;
