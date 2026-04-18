//! HTTP server and Socket.IO real-time communication manager.
//!
//! Mirrors `modules/WebManager.js`.
//!
//! * Static files are served from the `public/` directory for every request
//!   that is not handled by Socket.IO.
//! * Socket.IO events from clients are forwarded to the bridge via mpsc.
//! * The bridge calls `broadcast` / `send_to_client` to push messages back.
//!
//! **Lifecycle**: call `new()` once, then `start()` exactly once at startup.
//! After `start()` the internal `SocketIo` handle is populated and all emit
//! methods become available.

use axum::Router;
use serde::Serialize;
use socketioxide::{
    extract::{Data, SocketRef},
    socket::DisconnectReason,
    SocketIo,
};
use tower_http::{cors::CorsLayer, services::ServeDir};
use tokio::sync::mpsc::UnboundedSender;
use tracing::{info, warn};

use crate::messages::{BridgeMessage, WebEvent};

/// Manages the HTTP / Socket.IO layer.
pub struct WebManager {
    /// Sender used by event-handler closures to push events to the bridge.
    tx: UnboundedSender<BridgeMessage>,
    /// Populated by `start()`; used for broadcasting / unicasting.
    io: Option<SocketIo>,
}

impl WebManager {
    /// Create the manager.  Does NOT start the HTTP server yet.
    pub fn new(tx: UnboundedSender<BridgeMessage>) -> Self {
        Self { tx, io: None }
    }

    /// Start the HTTP + Socket.IO server on `port`.
    ///
    /// Registers all Socket.IO event handlers and spawns the axum server as a
    /// background tokio task.  Must be called exactly once before using any
    /// emit methods.
    pub async fn start(&mut self, port: u16) -> anyhow::Result<()> {
        let tx = self.tx.clone();
        let (socketio_layer, io) = SocketIo::new_layer();

        // ── Register Socket.IO handlers for every new connection ─────────────
        io.ns("/", {
            let tx = tx.clone();
            move |socket: SocketRef| {
                let client_id = socket.id.to_string();
                info!("Web client connected: {}", client_id);
                let _ = tx.send(BridgeMessage::Web(WebEvent::ClientConnected {
                    client_id: client_id.clone(),
                }));

                // slider_change: a slider value was updated.
                socket.on("slider_change", {
                    let tx = tx.clone();
                    move |s: SocketRef, Data::<serde_json::Value>(data)| {
                        let slider = data["slider"].as_str().unwrap_or("").to_string();
                        let address = data["address"].as_str().unwrap_or("").to_string();
                        let value = data["value"].as_f64().unwrap_or(0.0);
                        let _ = tx.send(BridgeMessage::Web(WebEvent::SliderChange {
                            client_id: s.id.to_string(),
                            slider,
                            address,
                            value,
                        }));
                    }
                });

                // button_click: a UI button was pressed.
                socket.on("button_click", {
                    let tx = tx.clone();
                    move |s: SocketRef, Data::<serde_json::Value>(data)| {
                        let button = data["button"].as_str().unwrap_or("").to_string();
                        let _ = tx.send(BridgeMessage::Web(WebEvent::ButtonClick {
                            client_id: s.id.to_string(),
                            button,
                        }));
                    }
                });

                // command_request: the client wants to run a system command.
                socket.on("command_request", {
                    let tx = tx.clone();
                    move |s: SocketRef, Data::<serde_json::Value>(data)| {
                        let command = data["command"].as_str().unwrap_or("").to_string();
                        let params = data["params"].clone();
                        let _ = tx.send(BridgeMessage::Web(WebEvent::CommandRequest {
                            client_id: s.id.to_string(),
                            command,
                            params,
                        }));
                    }
                });

                // Disconnect event.
                socket.on_disconnect({
                    let tx = tx.clone();
                    move |s: SocketRef, _: DisconnectReason| {
                        info!("Web client disconnected: {}", s.id);
                        let _ = tx.send(BridgeMessage::Web(WebEvent::ClientDisconnected {
                            client_id: s.id.to_string(),
                        }));
                    }
                });
            }
        });

        self.io = Some(io);

        // ── Build the axum router ─────────────────────────────────────────────
        // The socketioxide layer intercepts WebSocket upgrade requests.
        // Everything else falls through to ServeDir (the static file server).
        let app = Router::new()
            .fallback_service(ServeDir::new("public"))
            .layer(socketio_layer)
            .layer(CorsLayer::permissive());

        let listener =
            tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
        info!("Web server listening on http://0.0.0.0:{}", port);

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!("Web server error: {}", e);
            }
        });

        Ok(())
    }

    /// Broadcast an event to **all** connected web clients.
    pub fn broadcast<T: Serialize>(&self, event: &str, data: &T) {
        if let Some(io) = &self.io {
            if let Err(e) = io.emit(event.to_owned(), data) {
                warn!("Broadcast '{}' error: {}", event, e);
            }
        }
    }

    /// Send an event to a **specific** web client identified by its Socket.IO ID.
    ///
    /// Each socket is automatically in a room named after its own ID, so
    /// `io.to(client_id)` reaches exactly that client.
    pub fn send_to_client<T: Serialize>(&self, client_id: &str, event: &str, data: &T) {
        if let Some(io) = &self.io {
            if let Err(e) = io.to(client_id.to_string()).emit(event.to_owned(), data) {
                warn!("send_to_client '{}' → '{}' error: {}", event, client_id, e);
            }
        }
    }

    /// Return a clone of the internal `SocketIo` handle.
    ///
    /// Used by the bridge to pass the handle into spawned tasks (e.g. for
    /// async command execution that must emit a response after an `await`).
    pub fn get_io(&self) -> SocketIo {
        self.io
            .as_ref()
            .expect("WebManager::get_io called before start()")
            .clone()
    }
}
