# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                  # Run the bridge
node main.js --verbose     # Run with verbose logging
```

No test or lint scripts are configured.

## Architecture

This is **Lucibox Bridge** — a Node.js middleware that routes messages between Arduino hardware, OSC audio DSP (Pure Data), and a web UI. It runs on a Raspberry Pi embedded in a 4-looper guitar pedal.

### Core design principle

**Each module is fully independent** — no module may import or depend on another module. `main.js` is the only place where modules are wired together via callbacks. This isolation is intentional and must be preserved.

`main.js` is currently the single orchestration point but is acknowledged as too monolithic. A cleaner linking mechanism is a future goal.

### Priority

The **Arduino↔OSC bridge is the most critical path**: it must run reliably for hours on a Raspberry Pi without degradation. Robustness and stability of `ArduinoManager` and `OSCManager` take priority over all other features.

### Manager pattern

`main.js` instantiates 6 managers, registers cross-manager callbacks, and handles all protocol translation:

| Manager | Role |
|---|---|
| `ArduinoManager` | Serial port (38400 baud) — auto-detects port, sends/receives looper state |
| `OSCManager` | UDP OSC client + server — talks to Pure Data audio DSP |
| `WebManager` | Express 5 HTTP server + Socket.IO — serves `public/index.html`, relays events |
| `CLManager` | Executes system commands: git pull, reboot, poweroff, CPU temp |
| `MIDIManager` | **Stub — not implemented** |
| `PdManager` | **Stub — not implemented** |

### Message flow

```
Arduino (serial)  ──→  ArduinoManager  ──→  OSCManager  ──→  Pure Data (UDP)
Web client (WS)   ──→  WebManager      ──→  CLManager   ──→  system commands
```

Arduino serial format: `/lucibox/led/set 4 2` (space-separated path + values)  
OSC format: address `/lucibox/led/set` + typed args `[4, 2]`  
Socket.IO events: `slider_change`, `command_request`, `command_response`

