# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Rust port of the Node.js app at `https://github.com/AurelienConil/lucibox-3looper-pedal/tree/main/node`.

The app is a bridge between hardware (Arduino LUCIBOX pedal), Pure Data (OSC), and a web UI (Socket.IO).
Target platform: Raspberry Pi (Linux), but must also compile on macOS for dev.

## Commands

```bash
cargo build          # compile
cargo run            # build and run
cargo run -- -v      # Build and run with all logs
cargo test           # run all tests
cargo test <name>    # run a single test by name
cargo clippy         # lint
cargo fmt            # format code
```

## Architecture

This is a Rust binary crate named `lucibox` (edition 2021). Entry point is `src/main.rs`.

### Message flow (mirrors `main.js` routing)

```
Arduino serial  ──→ BridgeMessage::Arduino ──→ if /lucibox/* → OSC send
OSC inbound     ──→ BridgeMessage::Osc     ──→ if /lucibox/* → Arduino send
Web slider      ──→ BridgeMessage::Web     ──→ OSC send (address, value)
Web command_req ──→ BridgeMessage::Web     ──→ ClManager → command_response to client
CLManager event ──→ (internal)             ──→ Web broadcast command_status
MIDI inbound    ──→ stub (TODO)
PD process      ──→ stub (TODO)
```

### Module status

| File | Node.js source | Status |
|------|---------------|--------|
| `src/messages.rs` | — | ✅ Done |
| `src/managers/arduino.rs` | `ArduinoManager.js` | ✅ Done |
| `src/managers/osc.rs` | `OSCManager.js` | ✅ Done |
| `src/managers/web.rs` | `WebManager.js` | ✅ Done |
| `src/managers/cl.rs` | `CLManager.js` | ✅ Done |
| `src/managers/midi.rs` | `MIDIManager.js` | ✅ Done (stub) |
| `src/managers/pd.rs` | `PdManager.js` | ✅ Done (stub) |
| `src/main.rs` | `main.js` | ✅ Done |

---

## TODO list

### ~~1. Create `src/managers/midi.rs`~~ ✅ Done
### ~~2. Create `src/managers/pd.rs`~~ ✅ Done

### ~~3. Fix Rust toolchain version~~ ✅ Done (rustc 1.94.1)

### ~~4. Write `src/main.rs`~~ ✅ Done

### 5. End-to-end test
```bash
cargo build            # must compile without errors
cargo clippy           # no warnings
cargo run -- --verbose # starts bridge, connects Arduino, opens port 3000
```
