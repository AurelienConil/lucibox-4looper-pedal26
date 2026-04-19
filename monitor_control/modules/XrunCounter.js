'use strict';

/**
 * XrunCounter.js — Live XRUN counter driven by a persistent journalctl stream.
 *
 * From SPEC.md §"Compteur XRUN":
 *  - Source: `journalctl -u jack.service -f` (persistent SSH stream)
 *  - Any line containing the word "xrun" (case-insensitive) increments the counter
 *  - Counter resets to 0 on SSH reconnection (not between polls)
 *  - Emits 'update' whenever the count changes
 *
 * From IMPL.md §C ("Buffer des lignes"):
 *  - At startup, -n 100 may push 100 lines at once. Each line is processed
 *    individually but the UI flush is batched every 50ms to avoid over-rendering.
 *
 * Emits:
 *  - 'update'  (count: number) — After each line that contains "xrun"
 *  - 'reset'                   — After SSH reconnect resets the counter
 */

const EventEmitter = require('events');

// journalctl command that streams jack logs (last 100 lines + follow)
const JACK_JOURNAL_CMD = 'journalctl -u jack.service -f -n 100';

// Regex to detect an XRUN in a log line (case-insensitive)
const XRUN_REGEX = /xrun/i;

class XrunCounter extends EventEmitter {
  /**
   * @param {SSHManager} ssh — Shared SSH manager instance
   */
  constructor(ssh) {
    super();
    this._ssh = ssh;
    this._count = 0;

    // Unregister function returned by SSHManager.openStream()
    this._unregisterStream = null;

    // Listen for SSH reconnect events to reset the counter
    ssh.on('connected', () => this.reset());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * start — Open the persistent journalctl jack stream via SSHManager.
   * Safe to call multiple times (stops previous stream first).
   */
  start() {
    this.stop();
    this._unregisterStream = this._ssh.openStream(
      JACK_JOURNAL_CMD,
      this._handleLine.bind(this),
      this._handleStreamClose.bind(this)
    );
  }

  /**
   * stop — Unregister the jack journal stream.
   */
  stop() {
    if (this._unregisterStream) {
      this._unregisterStream();
      this._unregisterStream = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Counter
  // ---------------------------------------------------------------------------

  /**
   * reset — Set the counter to 0 and emit 'reset'.
   * Called automatically on SSH reconnect.
   */
  reset() {
    this._count = 0;
    this.emit('reset');
    this.emit('update', 0);
  }

  /**
   * getCount — Return the current XRUN count.
   * @returns {number}
   */
  getCount() {
    return this._count;
  }

  // ---------------------------------------------------------------------------
  // Internal handlers
  // ---------------------------------------------------------------------------

  /**
   * _handleLine — Process one line from the jack journal stream.
   * Increments the counter and emits 'update' if the line matches XRUN_REGEX.
   *
   * @param {string} line
   * @private
   */
  _handleLine(line) {
    if (XRUN_REGEX.test(line)) {
      this._count++;
      this.emit('update', this._count);
    }
  }

  /**
   * _handleStreamClose — Called when the persistent stream closes unexpectedly.
   * The SSHManager will re-open it on reconnect; nothing to do here.
   *
   * @private
   */
  _handleStreamClose() {
    // No-op: SSHManager handles stream restoration on reconnect
  }
}

module.exports = XrunCounter;
