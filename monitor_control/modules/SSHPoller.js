'use strict';

/**
 * SSHPoller.js — Generic reusable SSH polling module (from IMPL.md §"Module SSHPoller").
 *
 * Runs a command on the RPi at a fixed interval, parses the output with a
 * provided function, and emits a 'data' event with the parsed value.
 *
 * Usage:
 *   const poller = new SSHPoller(ssh, 'cat /sys/class/thermal/thermal_zone0/temp', 5000, parseCpuTemp);
 *   poller.on('data', (value) => statusColumn.updateTemp(value));
 *   poller.start();
 *   // later:
 *   poller.stop();
 *
 * Emits:
 *   - 'data'  — Parsed value after each successful poll
 *   - 'error' — Raw error if the SSH exec or parser throws
 */

const EventEmitter = require('events');

class SSHPoller extends EventEmitter {
  /**
   * @param {SSHManager} ssh          — Shared SSH manager instance
   * @param {string}     command      — Shell command to run on the RPi
   * @param {number}     intervalMs   — Polling interval in milliseconds
   * @param {Function}   parserFn     — (stdout: string) => parsedValue — may throw
   */
  constructor(ssh, command, intervalMs, parserFn) {
    super();
    this._ssh = ssh;
    this._command = command;
    this._intervalMs = intervalMs;
    this._parserFn = parserFn;
    this._timer = null;
    this._running = false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * start — Begin polling at the configured interval.
   * Runs one immediate poll, then continues at intervalMs.
   * No-op if already running.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this.runOnce();
    this._timer = setInterval(() => this.runOnce(), this._intervalMs);
  }

  /**
   * stop — Stop polling and clear the interval timer.
   */
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._running = false;
    this._timer = null;
  }

  /**
   * runOnce — Execute the command once and emit 'data' with the parsed result.
   *
   * Silently skips if SSH is not connected (the poller will catch up on the
   * next tick once the connection is restored).
   *
   * @returns {Promise<void>}
   */
  async runOnce() {
    if (!this._ssh.isConnected()) return;
    try {
      const stdout = await this._ssh.exec(this._command);
      let value;
      try {
        value = this._parserFn(stdout);
      } catch (e) {
        this.emit('error', e);
        return;
      }
      this.emit('data', value);
    } catch (err) {
      this.emit('error', err);
    }
  }
}

module.exports = SSHPoller;
