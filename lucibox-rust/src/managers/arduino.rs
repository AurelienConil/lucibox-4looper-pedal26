//! Serial communication manager for the Arduino LUCIBOX device.
//!
//! Mirrors `modules/ArduinoManager.js`.
//!
//! On startup, scans every available serial port and connects to the first
//! one that replies with the `LUCIBOX` handshake string.  Incoming
//! newline-delimited messages are forwarded to the bridge over an unbounded
//! mpsc channel.  Outgoing commands are written through a separate clone of
//! the port handle so reads and writes never block each other.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, error, info, warn};

use crate::messages::{ArduinoMessage, BridgeMessage};

/// Serial baud rate expected by the Arduino firmware.
const BAUD_RATE: u32 = 38_400;
/// String the Arduino sends during the handshake phase.
const HANDSHAKE_KEYWORD: &str = "LUCIBOX";
/// First message sent to the Arduino after connection (matches Node.js behaviour).
const INIT_COMMAND: &str = "/lucibox/init 0 0";
/// Delay before sending the init command, giving the Arduino time to boot.
const INIT_DELAY_MS: u64 = 2_000;
/// Per-read timeout when probing a port.
const TEST_READ_TIMEOUT_MS: u64 = 500;
/// Total time budget per port during the handshake probe.
const TEST_TOTAL_TIMEOUT_SECS: u64 = 5;

/// Manages the serial connection to the Arduino LUCIBOX hardware.
pub struct ArduinoManager {
    /// Forwards incoming Arduino messages to the bridge event loop.
    tx: UnboundedSender<BridgeMessage>,
    /// Write handle — shared with `send_command` and the connect logic.
    write_port: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
    is_connected: Arc<Mutex<bool>>,
}

impl ArduinoManager {
    /// Create a new ArduinoManager with the bridge channel sender.
    ///
    /// The tx channel is used to forward all incoming Arduino messages
    /// to the bridge's event loop for routing to other managers.
    pub fn new(tx: UnboundedSender<BridgeMessage>) -> Self {
        Self {
            tx,
            write_port: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    /// Scan all available serial ports and connect to the first LUCIBOX device.
    pub async fn find_and_connect(&self) -> anyhow::Result<()> {
        let ports = serialport::available_ports()
            .map_err(|e| anyhow::anyhow!("Cannot list serial ports: {}", e))?;

        if ports.is_empty() {
            anyhow::bail!("No serial ports available");
        }

        for port_info in &ports {
            let name = port_info.port_name.clone();
            info!("Testing port: {}", name);

            // Run the blocking probe in a dedicated thread so the async
            // runtime is not stalled.
            let found =
                tokio::task::spawn_blocking(move || Self::test_port_blocking(&name)).await?;

            if found {
                info!("LUCIBOX found on port: {}", port_info.port_name);
                self.connect(&port_info.port_name).await?;
                return Ok(());
            }
        }

        anyhow::bail!("No LUCIBOX device found on any serial port")
    }

    /// Blocking: open `port_name` and wait up to 5 s for the LUCIBOX keyword.
    fn test_port_blocking(port_name: &str) -> bool {
        let mut port = match serialport::new(port_name, BAUD_RATE)
            .timeout(Duration::from_millis(TEST_READ_TIMEOUT_MS))
            .open()
        {
            Ok(p) => p,
            Err(e) => {
                debug!("Cannot open {}: {}", port_name, e);
                return false;
            }
        };

        let deadline =
            std::time::Instant::now() + Duration::from_secs(TEST_TOTAL_TIMEOUT_SECS);
        let mut buf = vec![0u8; 128];
        let mut accum = String::new();

        while std::time::Instant::now() < deadline {
            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    accum.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if accum.contains(HANDSHAKE_KEYWORD) {
                        return true;
                    }
                }
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        false
    }

    /// Open write + read handles, start the background reader, send init command.
    async fn connect(&self, port_name: &str) -> anyhow::Result<()> {
        // Two handles: one kept for writes (sync), one given to the read thread (blocking).
        // We clone the port so reads and writes never block each other.
        let write_port = serialport::new(port_name, BAUD_RATE)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| anyhow::anyhow!("Cannot open {}: {}", port_name, e))?;

        let read_port = write_port
            .try_clone()
            .map_err(|e| anyhow::anyhow!("Cannot clone serial port: {}", e))?;

        // Store the write handle in an Arc<Mutex<>> so send_command can access it.
        *self.write_port.lock().unwrap() = Some(write_port);
        *self.is_connected.lock().unwrap() = true;

        // Spawn a OS thread (not tokio task) to read from the port continuously.
        // serialport is blocking, so we can't use tokio tasks here.
        self.spawn_read_loop(read_port);

        // Match the 2-second delay from the Node.js version.
        // This gives the Arduino time to initialize after serial connection.
        tokio::time::sleep(Duration::from_millis(INIT_DELAY_MS)).await;
        self.send_command(INIT_COMMAND)?;
        info!("Arduino connected and initialised");
        Ok(())
    }

    /// Spawn a OS thread that reads newline-delimited messages and forwards
    /// them to the bridge.  A thread (not a tokio task) is used because
    /// `serialport` is a blocking, sync API.
    fn spawn_read_loop(&self, mut port: Box<dyn serialport::SerialPort>) {
        let is_connected = Arc::clone(&self.is_connected);
        let tx = self.tx.clone();

        std::thread::spawn(move || {
            let mut line = String::new();
            let mut byte = [0u8; 1];

            loop {
                if !*is_connected.lock().unwrap() {
                    break;
                }

                match port.read(&mut byte) {
                    Ok(1) => {
                        let ch = byte[0] as char;
                        if ch == '\n' {
                            let trimmed = line.trim().to_string();
                            line.clear();
                            if !trimmed.is_empty() {
                                debug!("Arduino → {}", trimmed);
                                if tx
                                    .send(BridgeMessage::Arduino(ArduinoMessage {
                                        raw: trimmed,
                                    }))
                                    .is_err()
                                {
                                    break; // bridge dropped, exit thread
                                }
                            }
                        } else if ch != '\r' {
                            line.push(ch);
                        }
                    }
                    Ok(_) => {}
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // Normal on idle lines — keep polling.
                    }
                    Err(e) => {
                        error!("Serial read error: {}", e);
                        break;
                    }
                }
            }
            warn!("Arduino read loop exited");
        });
    }

    /// Write a command string to the Arduino, terminated with `\n`.
    pub fn send_command(&self, command: &str) -> anyhow::Result<()> {
        let mut guard = self.write_port.lock().unwrap();
        let port = guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Arduino not connected"))?;

        let msg = format!("{}\n", command);
        port.write_all(msg.as_bytes())
            .map_err(|e| anyhow::anyhow!("Serial write error: {}", e))?;

        debug!("Arduino ← {}", command);
        Ok(())
    }

    /// Close the serial connection and stop the read loop.
    pub fn disconnect(&self) {
        *self.is_connected.lock().unwrap() = false;
        *self.write_port.lock().unwrap() = None;
        info!("Arduino disconnected");
    }

    pub fn is_connected(&self) -> bool {
        *self.is_connected.lock().unwrap()
    }
}
