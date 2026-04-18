//! MIDI manager stub.
//!
//! Mirrors `modules/MIDIManager.js`.
//! The Node.js original is itself a stub — MIDI support is not yet implemented.

use tracing::info;

pub struct MidiManager;

impl MidiManager {
    pub fn new() -> Self {
        Self
    }

    pub fn initialize(&self) {
        info!("MIDI Manager initialized (stub)");
    }

    pub fn disconnect(&self) {
        info!("MIDI disconnected (stub)");
    }
}
