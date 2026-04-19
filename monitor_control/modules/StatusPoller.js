'use strict';

/**
 * StatusPoller.js — Orchestrates all periodic metric polling for the Runtime screen.
 *
 * Wraps multiple SSHPoller instances (one per metric) and exposes a simple
 * event-driven API to the UI layer.
 *
 * Metrics managed (from SPEC.md):
 *  - Services status  (jack, lucibox-node, lucibox-pd) — refresh 5s
 *  - CPU Temperature                                   — refresh 5s
 *  - CPU Usage                                         — refresh 5s
 *  - RT Processes (pd, node scheduling policy)         — refresh 10s
 *  - Git version                                       — on startup + after Git Pull
 *
 * From IMPL.md §A — CPU Usage: avoid top -bn1, prefer vmstat or /proc/stat.
 * From IMPL.md §B — use `pgrep -o -x pd` and `pgrep -o -f "node main.js"` (oldest, one PID guaranteed).
 *
 * Emits:
 *  - 'services'    ({ jack, node, pd }: { [name]: 'active'|'inactive'|'failed' })
 *  - 'cpuTemp'     (tempCelsius: number)
 *  - 'cpuUsage'    (usagePercent: number)
 *  - 'rtProcesses' ({ pd, node }: { [name]: string })  — e.g. 'SCHED_FIFO/70'
 *  - 'version'     (versionString: string)             — e.g. 'a3f1d2c "fix loop sync"'
 */

const EventEmitter = require('events');
const SSHPoller = require('./SSHPoller');
const OutputParsers = require('./OutputParsers');

// Polling intervals
const INTERVAL_SERVICES_MS = 5000;
const INTERVAL_CPU_TEMP_MS = 5000;
const INTERVAL_CPU_USAGE_MS = 5000;
const INTERVAL_RT_PROCS_MS = 10000;

// SSH commands
const CMD_SERVICE = (name) => `systemctl is-active ${name}`;
const CMD_CPU_TEMP = 'cat /sys/class/thermal/thermal_zone0/temp';
// vmstat: 2 samples at 1-second interval — parse the last line for idle %
// (from IMPL.md §A: prefer vmstat over top -bn1)
const CMD_CPU_USAGE = 'vmstat 1 2 | tail -1';
const CMD_RT_PD   = 'chrt -p $(pgrep -o -x pd)';
const CMD_RT_NODE = 'chrt -p $(pgrep -o -f "node main.js")';
const CMD_VERSION = 'git -C /home/patch/lucibox log -1 --format="%h %s"';

class StatusPoller extends EventEmitter {
  /**
   * @param {SSHManager} ssh — Shared SSH manager instance
   */
  constructor(ssh) {
    super();
    this._ssh = ssh;

    // Individual pollers — created in start(), stopped in stop()
    this._pollers = [];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * start — Create and start all SSHPoller instances.
   * Safe to call after SSH reconnect.
   */
  start() {
    // Services poller (custom, not SSHPoller)
    const servicesPoller = new SSHPoller(
      this._ssh,
      `${CMD_SERVICE('jack')}; ${CMD_SERVICE('lucibox-node')}; ${CMD_SERVICE('lucibox-pd')}`,
      INTERVAL_SERVICES_MS,
      (stdout) => {
        // Each command prints a line, parse each
        const lines = stdout.trim().split(/\r?\n/);
        return {
          jack: OutputParsers.parseServiceStatus(lines[0] || ''),
          node: OutputParsers.parseServiceStatus(lines[1] || ''),
          pd: OutputParsers.parseServiceStatus(lines[2] || ''),
        };
      }
    );
    servicesPoller.on('data', (obj) => this.emit('services', obj));
    this._pollers.push(servicesPoller);

    // CPU Temp
    const cpuTempPoller = new SSHPoller(this._ssh, CMD_CPU_TEMP, INTERVAL_CPU_TEMP_MS, OutputParsers.parseCpuTemp);
    cpuTempPoller.on('data', (v) => this.emit('cpuTemp', v));
    this._pollers.push(cpuTempPoller);

    // CPU Usage
    const cpuUsagePoller = new SSHPoller(this._ssh, CMD_CPU_USAGE, INTERVAL_CPU_USAGE_MS, OutputParsers.parseCpuUsage);
    cpuUsagePoller.on('data', (v) => this.emit('cpuUsage', v));
    this._pollers.push(cpuUsagePoller);

    // RT Processes (custom, not SSHPoller)
    const rtPoller = new SSHPoller(
      this._ssh,
      `${CMD_RT_PD} && echo '---' && ${CMD_RT_NODE}`,
      INTERVAL_RT_PROCS_MS,
      (stdout) => {
        // Split by ---
        const [pdOut, nodeOut] = stdout.split(/---/);
        return {
          pd: OutputParsers.parseRtPolicy(pdOut || ''),
          node: OutputParsers.parseRtPolicy(nodeOut || ''),
        };
      }
    );
    rtPoller.on('data', (obj) => this.emit('rtProcesses', obj));
    this._pollers.push(rtPoller);

    // Start all pollers
    for (const poller of this._pollers) poller.start();

    // Version (one-shot)
    this.refreshVersion();
  }

  /**
   * stop — Stop and discard all pollers.
   */
  stop() {
    for (const poller of this._pollers) poller.stop();
    this._pollers = [];
  }

  /**
   * refreshAll — Trigger an immediate one-shot run on all pollers.
   * Called when the user presses [r] (Refresh).
   */
  refreshAll() {
    for (const poller of this._pollers) poller.runOnce();
  }

  /**
   * refreshVersion — Fetch the latest git version once.
   * Called at startup and after a successful Git Pull.
   */
  async refreshVersion() {
    try {
      const stdout = await this._ssh.exec(CMD_VERSION);
      const version = OutputParsers.parseVersion(stdout);
      this.emit('version', version);
    } catch (e) {
      // ignore
    }
  }
}

module.exports = StatusPoller;
