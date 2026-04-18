use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

mod managers;
mod messages;

use managers::{
    arduino::ArduinoManager, cl::ClManager, midi::MidiManager, osc::OscManager, pd::PdManager,
    web::WebManager,
};
use messages::{BridgeMessage, CommandResponse, CommandStatus, WebEvent};

// ─── Entry point ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Parse --verbose / -v flag (mirrors `main.js` arg parsing).
    let verbose = std::env::args().any(|a| a == "--verbose" || a == "-v");

    // Init tracing (equivalent to Logger in Node.js).
    let filter = if verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| filter.into()),
        )
        .init();

    if verbose {
        info!("Mode verbose activé");
    } else {
        info!("Mode production (utilisez --verbose pour plus de détails)");
    }

    let bridge = LuciboxBridge::new();
    bridge.start().await;
}

// --------------------------------------------- Lucibox Bridge ---------------------------------------------

struct LuciboxBridge;

impl LuciboxBridge {
    fn new() -> Self {
        Self
    }

    async fn start(&self) {
        info!("//////////////////////");
        info!("BRIDGE ARDUINO OSC");
        info!("//////////////////////");

        // Shared channel — every manager sends BridgeMessage here.
        let (tx, mut rx) = mpsc::unbounded_channel::<BridgeMessage>();

        // ── Instantiate managers ──────────────────────────────────────────────
        let arduino = ArduinoManager::new(tx.clone());
        let osc = match OscManager::initialize_default().await {
            Ok(m) => m,
            Err(e) => {
                error!("OSC init failed: {}", e);
                return;
            }
        };
        let mut web = WebManager::new(tx.clone());
        let midi = MidiManager::new();
        let _pd = PdManager::new();
        let cl = ClManager::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            vec![
                "git_pull".into(),
                "git_commit".into(),
                "restart".into(),
                "poweroff".into(),
                "reboot".into(),
                "update_system".into(),
                "check_status".into(),
                "cpu_temp".into(),
            ],
        );

        // ── Start services ────────────────────────────────────────────────────
        if let Err(e) = arduino.find_and_connect().await {
            warn!("Arduino not found: {}", e);
        }

        osc.start_listening(tx.clone());

        if let Err(e) = web.start(3000).await {
            error!("Web server failed to start: {}", e);
            return;
        }

        midi.initialize();

        info!("All modules started successfully");

        // ── Bridge event loop ─────────────────────────────────────────────────
        loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    handle_message(msg, &arduino, &osc, &web, &cl).await;
                }
                _ = tokio::signal::ctrl_c() => {
                    break;
                }
            }
        }

        // ── Graceful shutdown (mirrors bridge.stop()) ─────────────────────────
        info!("\nStopping all modules...");
        arduino.disconnect();
        osc.stop_listening();
        midi.disconnect();
        info!("Bridge stopped");
    }
}

// ─── Message routing (mirrors setupMessageRouting) ───────────────────────────

async fn handle_message(
    msg: BridgeMessage,
    arduino: &ArduinoManager,
    osc: &OscManager,
    web: &WebManager,
    cl: &ClManager,
) {
    match msg {
        // Arduino → OSC
        // If the raw message looks like "/lucibox/... <int>", forward to OSC.
        BridgeMessage::Arduino(m) => {
            tracing::debug!("Arduino message received: {}", m.raw);
            if m.raw.starts_with("/lucibox/") {
                let parts: Vec<&str> = m.raw.splitn(2, ' ').collect();
                if parts.len() >= 2 {
                    let address = parts[0];
                    if let Ok(value) = parts[1].trim().parse::<i32>() {
                        if let Err(e) = osc
                            .send_message(address, vec![rosc::OscType::Int(value)])
                            .await
                        {
                            error!("OSC send error: {}", e);
                        } else {
                            tracing::debug!("OSC -> {} {}", address, value);
                        }
                    }
                }
            }
        }

        // OSC → Arduino
        // If the OSC address starts with /lucibox/, format and send to Arduino.
        BridgeMessage::Osc(event) => {
            if event.address.starts_with("/lucibox/") {
                let mut message = event.address.clone();
                for val in &event.args {
                    message.push(' ');
                    message.push_str(&osc_arg_to_string(val));
                }
                tracing::debug!("OSC <- {}", message);
                if let Err(e) = arduino.send_command(&message) {
                    error!("Arduino send error: {}", e);
                }
            }
        }

        // Web events → routing
        BridgeMessage::Web(event) => match event {
            // slider_change → OSC
            WebEvent::SliderChange { address, value, .. } => {
                tracing::debug!("Slider changed to {}", value);
                if !address.is_empty() {
                    if let Err(e) = osc
                        .send_message(&address, vec![rosc::OscType::Float(value as f32)])
                        .await
                    {
                        error!("OSC send error: {}", e);
                    } else {
                        tracing::debug!("OSC -> {} {}", address, value);
                    }
                }
            }

            // button_click → log only (no routing defined in Node.js)
            WebEvent::ButtonClick { button, .. } => {
                tracing::debug!("Bouton {} cliqué", button);
            }

            // command_request → ClManager → response to client
            WebEvent::CommandRequest {
                client_id,
                command,
                params,
            } => {
                tracing::debug!(
                    "Requête de commande reçue: {} avec params {}",
                    command,
                    params
                );
                handle_command_request(&client_id, &command, &params, cl, web, osc).await;
            }

            WebEvent::ClientConnected { client_id } => {
                info!("Web client connected: {}", client_id);
            }
            WebEvent::ClientDisconnected { client_id } => {
                info!("Web client disconnected: {}", client_id);
            }
        },
    }
}

// ─── Command request handler (mirrors handleCommandRequest) ──────────────────

async fn handle_command_request(
    client_id: &str,
    command: &str,
    params: &serde_json::Value,
    cl: &ClManager,
    web: &WebManager,
    osc: &OscManager,
) {
    info!(
        "Exécution de la commande \"{}\" demandée par {}",
        command, client_id
    );

    if !cl.is_allowed(command) {
        web.send_to_client(
            client_id,
            "command_response",
            &CommandResponse {
                command: command.to_string(),
                success: false,
                result: None,
                message: format!("Commande inconnue: {}", command),
            },
        );
        return;
    }

    // Notify the requesting client that execution has started.
    web.send_to_client(
        client_id,
        "command_status",
        &CommandStatus {
            status_type: "command_started".into(),
            command: command.to_string(),
            message: format!("Exécution de {}...", command),
        },
    );

    // Broadcast to all clients (mirrors clManager.onMessage).
    web.broadcast(
        "command_status",
        &CommandStatus {
            status_type: "command_started".into(),
            command: command.to_string(),
            message: format!("Exécution de {}...", command),
        },
    );

    match cl.execute_command(command, params).await {
        Ok(result) => {
            // Broadcast completed status to all clients.
            web.broadcast(
                "command_status",
                &CommandStatus {
                    status_type: "command_completed".into(),
                    command: command.to_string(),
                    message: format!("{} exécuté avec succès", command),
                },
            );

            // If git_pull succeeded, notify Pure Data via OSC.
            if command == "git_pull" {
                let _ = osc
                    .send_message("/lucibox/system/updated", vec![rosc::OscType::Int(1)])
                    .await;
            }

            // Send result to the requesting client.
            web.send_to_client(
                client_id,
                "command_response",
                &CommandResponse {
                    command: command.to_string(),
                    success: true,
                    result: Some(result),
                    message: format!("{} exécuté avec succès", command),
                },
            );
        }
        Err(e) => {
            error!("Erreur lors de l'exécution de {}: {}", command, e);
            web.send_to_client(
                client_id,
                "command_response",
                &CommandResponse {
                    command: command.to_string(),
                    success: false,
                    result: None,
                    message: e.to_string(),
                },
            );
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn osc_arg_to_string(arg: &rosc::OscType) -> String {
    match arg {
        rosc::OscType::Int(v) => v.to_string(),
        rosc::OscType::Float(v) => v.to_string(),
        rosc::OscType::Double(v) => v.to_string(),
        rosc::OscType::Long(v) => v.to_string(),
        rosc::OscType::String(v) => v.clone(),
        rosc::OscType::Bool(v) => v.to_string(),
        _ => String::new(),
    }
}
