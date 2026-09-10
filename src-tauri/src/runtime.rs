//! Tokio runtime helpers shared by the desktop app and the web server.
//!
//! The desktop app runs inside Tauri's tokio runtime; the web server owns its
//! own. These helpers reuse the current runtime when one is available and fall
//! back to a process-wide runtime otherwise, so shared provider code never has
//! to depend on Tauri.

use std::future::Future;
use std::sync::OnceLock;

use tokio::runtime::{Handle, Runtime};

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn fallback() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("openquota-runtime")
            .build()
            .expect("failed to build the OpenQuota runtime")
    })
}

pub fn handle() -> Handle {
    Handle::try_current().unwrap_or_else(|_| fallback().handle().clone())
}

pub fn spawn<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    handle().spawn(future)
}

pub fn spawn_blocking<F, R>(func: F) -> tokio::task::JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    handle().spawn_blocking(func)
}
