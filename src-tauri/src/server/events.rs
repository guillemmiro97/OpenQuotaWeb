use serde::Serialize;
use tokio::sync::broadcast;

/// A server-sent event forwarded to every connected browser.
#[derive(Debug, Clone)]
pub struct ServerEvent {
    pub name: String,
    pub data: String,
}

pub type EventSender = broadcast::Sender<ServerEvent>;

pub fn channel() -> EventSender {
    broadcast::channel(512).0
}

/// Broadcast an event to connected browsers. Serialization failures and the
/// "no receivers" case are intentionally ignored.
pub fn emit<T: Serialize>(sender: &EventSender, name: &str, payload: &T) {
    if sender.receiver_count() == 0 {
        return;
    }
    if let Ok(data) = serde_json::to_string(payload) {
        let _ = sender.send(ServerEvent {
            name: name.to_owned(),
            data,
        });
    }
}
