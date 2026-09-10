use std::path::PathBuf;

/// Persistent application data directory used by the web server.
///
/// Mirrors Tauri's `app_data_dir` (XDG data home + bundle identifier) so the
/// same database, pricing cache and provider state are reused.
pub fn app_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("OPENQUOTA_APP_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .unwrap_or_else(|| PathBuf::from("/data/xdg-data"));
    base.join("io.github.deviffyy.openquota")
}
