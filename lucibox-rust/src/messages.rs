//! Shared message types that flow through the central bridge channel.
//!
//! Every manager that produces events converts them into a `BridgeMessage`
//! and sends it to the bridge via the shared `UnboundedSender`.
//! The bridge dispatches each message to the relevant handler.

use serde::{Deserialize, Serialize};

/// All events that can be sent from any manager to the bridge's main loop.
#[derive(Debug)]
pub enum BridgeMessage {
    Arduino(ArduinoMessage),
    Web(WebEvent),
    Osc(OscEvent),
}

// ─── Arduino ─────────────────────────────────────────────────────────────────

/// A raw newline-delimited message received from the Arduino over serial.
#[derive(Debug)]
pub struct ArduinoMessage {
    pub raw: String,
}

// ─── Web ──────────────────────────────────────────────────────────────────────

/// Events emitted by web clients through the Socket.IO interface.
#[derive(Debug)]
pub enum WebEvent {
    /// A slider value was changed by a web client.
    SliderChange {
        client_id: String,
        slider: String,
        address: String,
        value: f64,
    },
    /// A UI button was clicked by a web client.
    ButtonClick {
        client_id: String,
        button: String,
    },
    /// A web client requested execution of an allowed system command.
    CommandRequest {
        client_id: String,
        command: String,
        params: serde_json::Value,
    },
    /// A new web client connected via Socket.IO.
    ClientConnected { client_id: String },
    /// A web client disconnected.
    ClientDisconnected { client_id: String },
}

// ─── OSC ──────────────────────────────────────────────────────────────────────

/// An OSC message received on the UDP listening port.
#[derive(Debug)]
pub struct OscEvent {
    pub address: String,
    pub args: Vec<rosc::OscType>,
}

// ─── Outbound web payloads ────────────────────────────────────────────────────

/// Sent to the requesting web client once a system command finishes.
#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResponse {
    pub command: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    pub message: String,
}

/// Broadcast to all web clients when a command changes state (started / completed).
#[derive(Debug, Serialize, Deserialize)]
pub struct CommandStatus {
    /// One of: `"command_started"`, `"command_completed"`.
    #[serde(rename = "type")]
    pub status_type: String,
    pub command: String,
    pub message: String,
}
