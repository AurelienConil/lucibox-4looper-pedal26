//! OSC (Open Sound Control) communication manager.
//!
//! Mirrors `modules/OSCManager.js`.
//!
//! * **Sending** — an ephemeral UDP socket connects to Pure Data
//!   (default `127.0.0.1:8000`).  The `OscSender` handle is cheap to clone
//!   and can be shared with spawned tasks.
//! * **Receiving** — `start_listening` spawns a tokio task that binds to the
//!   server port (default `8001`) and forwards decoded OSC packets to the
//!   bridge via mpsc.

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, error, info};

use crate::messages::{BridgeMessage, OscEvent};

const DEFAULT_CLIENT_HOST: &str = "127.0.0.1";
const DEFAULT_CLIENT_PORT: u16 = 8_000;
const DEFAULT_SERVER_PORT: u16 = 8_001;

// ─── OscSender ───────────────────────────────────────────────────────────────

/// Thin, cheaply cloneable handle used to send OSC messages.
/// Held by the bridge and passed into spawned tasks.
#[derive(Clone)]
pub struct OscSender {
    socket: Arc<UdpSocket>,
    target: SocketAddr,
}

impl OscSender {
    /// Encode an OSC message and send it to the configured target.
    pub async fn send_message(
        &self,
        address: &str,
        args: Vec<rosc::OscType>,
    ) -> anyhow::Result<()> {
        let packet = rosc::OscPacket::Message(rosc::OscMessage {
            addr: address.to_string(),
            args,
        });
        let buf = rosc::encoder::encode(&packet)?;
        self.socket.send_to(&buf, self.target).await?;
        debug!("OSC → {} ({} bytes)", address, buf.len());
        Ok(())
    }
}

// ─── OscManager ──────────────────────────────────────────────────────────────

/// Manages OSC communication: sends to Pure Data, listens for inbound messages.
pub struct OscManager {
    sender: OscSender,
    /// UDP port on which this process listens for incoming OSC.
    server_port: u16,
}

impl OscManager {
    /// Initialise with explicit host/port parameters.
    pub async fn initialize(
        client_host: &str,
        client_port: u16,
        server_port: u16,
    ) -> anyhow::Result<Self> {
        // Bind to an ephemeral port for outbound traffic.
        let send_socket = UdpSocket::bind("0.0.0.0:0").await?;
        let target: SocketAddr = format!("{}:{}", client_host, client_port).parse()?;

        info!("OSC client → {}:{}", client_host, client_port);
        info!("OSC server will listen on port {}", server_port);

        Ok(Self {
            sender: OscSender {
                socket: Arc::new(send_socket),
                target,
            },
            server_port,
        })
    }

    /// Initialise using project defaults (Pure Data on localhost:8000, listen on 8001).
    pub async fn initialize_default() -> anyhow::Result<Self> {
        Self::initialize(DEFAULT_CLIENT_HOST, DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT).await
    }

    /// Return a cloneable sender handle for use in spawned tasks.
    pub fn sender(&self) -> OscSender {
        self.sender.clone()
    }

    /// Send an OSC message to Pure Data.
    pub async fn send_message(
        &self,
        address: &str,
        args: Vec<rosc::OscType>,
    ) -> anyhow::Result<()> {
        self.sender.send_message(address, args).await
    }

    /// Spawn the background task that receives OSC packets and forwards them
    /// to the bridge.
    pub fn start_listening(&self, bridge_tx: UnboundedSender<BridgeMessage>) {
        let server_port = self.server_port;

        tokio::spawn(async move {
            let socket = match UdpSocket::bind(format!("0.0.0.0:{}", server_port)).await {
                Ok(s) => s,
                Err(e) => {
                    error!(
                        "Cannot bind OSC server socket on port {}: {}",
                        server_port, e
                    );
                    return;
                }
            };
            info!("OSC server listening on port {}", server_port);

            let mut buf = vec![0u8; 4_096];
            loop {
                let n = match socket.recv(&mut buf).await {
                    Ok(n) => n,
                    Err(e) => {
                        error!("OSC receive error: {}", e);
                        break;
                    }
                };

                match rosc::decoder::decode_udp(&buf[..n]) {
                    Ok((_, rosc::OscPacket::Message(msg))) => {
                        debug!("OSC ← {} ({} arg(s))", msg.addr, msg.args.len());
                        if bridge_tx
                            .send(BridgeMessage::Osc(OscEvent {
                                address: msg.addr,
                                args: msg.args,
                            }))
                            .is_err()
                        {
                            break; // bridge dropped — exit task
                        }
                    }
                    Ok((_, rosc::OscPacket::Bundle(_))) => {
                        // OSC bundles are not used in this project.
                    }
                    Err(e) => {
                        error!("OSC decode error: {}", e);
                    }
                }
            }
        });
    }

    /// Stop the OSC manager (informational; the background task will exit
    /// when the bridge channel is dropped).
    pub fn stop_listening(&self) {
        info!("OSC manager stopped");
    }
}
