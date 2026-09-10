use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};

use crate::providers::api_key::{SecretBackend, SecretBytes};

use super::paths;

/// File-backed credential store used by the web deployment.
///
/// The desktop app stores API keys in the operating system credential store
/// (Secret Service / Keychain / Credential Manager). A headless server has no
/// such store, so keys are kept in a `0600` JSON file inside the persistent
/// data directory. Values are base64-encoded so the file stays valid JSON.
pub struct FileSecretBackend {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileSecretBackend {
    pub fn new() -> Self {
        Self {
            path: paths::app_data_dir().join("secrets.json"),
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> BTreeMap<String, String> {
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn store(&self, map: &BTreeMap<String, String>) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "The credential store directory could not be created.".to_owned())?;
        }
        let payload = serde_json::to_vec(map)
            .map_err(|_| "The credential store could not be serialized.".to_owned())?;
        let temporary = self.path.with_extension("json.tmp");
        {
            let mut file = fs::File::create(&temporary)
                .map_err(|_| "The credential store could not be written.".to_owned())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
            }
            file.write_all(&payload)
                .map_err(|_| "The credential store could not be written.".to_owned())?;
            let _ = file.sync_all();
        }
        fs::rename(&temporary, &self.path)
            .map_err(|_| "The credential store could not be saved.".to_owned())?;
        Ok(())
    }
}

impl Default for FileSecretBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretBackend for FileSecretBackend {
    fn read(&self, account: &str) -> Result<Option<SecretBytes>, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "The credential store is unavailable.".to_owned())?;
        let map = self.load();
        Ok(map
            .get(account)
            .and_then(|value| STANDARD.decode(value).ok())
            .map(SecretBytes::new))
    }

    fn write(&self, account: &str, value: &[u8]) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "The credential store is unavailable.".to_owned())?;
        let mut map = self.load();
        map.insert(account.to_owned(), STANDARD.encode(value));
        self.store(&map)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "The credential store is unavailable.".to_owned())?;
        let mut map = self.load();
        map.remove(account);
        self.store(&map)
    }
}
