'use strict';

/**
 * SSHManager.js — Single shared SSH connection manager.
 *
 * Architecture (from IMPL.md):
 *  - ONE ssh2 Client instance shared by all modules.
 *  - SSH supports native multiplexing: multiple conn.exec() calls run
 *    concurrently on the same TCP socket.
 *  - 3 persistent stream channels: journalctl -f for node, pd, jack (XRUNs)
 *  - N one-shot channels for periodic polls and button actions
 *
 * Reconnection strategy (from IMPL.md §E):
 *  - Exponential backoff: 1s → 2s → 4s → 8s … max 30s
 *  - On reconnect: re-open all persistent streams, reset XRUN counter
 *  - Emit 'connected' / 'disconnected' / 'reconnecting' events
 *
 * Emits:
 *  - 'connected'        — SSH handshake complete, ready to use
 *  - 'disconnected'     — Connection dropped (before retry)
 *  - 'reconnecting'     — About to attempt a reconnection (includes attempt count)
 *  - 'error'            — Unrecoverable SSH error
 */

const { Client } = require('ssh2');
const EventEmitter = require('events');

// Reconnection backoff parameters
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

class SSHManager extends EventEmitter {
  /**
   * @param {object} config  — SSH credentials from ConfigLoader
   * @param {string} config.host
   * @param {number} config.port
   * @param {string} config.username
   * @param {string} config.password
   */
  constructor(config) {
    super();
    this._config = config;
    this._client = null;

    // Whether the manager should attempt reconnections (false after explicit disconnect())
    this._shouldReconnect = true;

    // Backoff state
    this._backoffMs = BACKOFF_INITIAL_MS;
    this._reconnectTimer = null;

    // Set of registered stream factories: called after each (re)connect to
    // re-open persistent journalctl streams.
    // Each entry is a function: (client) => void
    this._streamFactories = new Set();
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * connect — Initiate the SSH connection.
   * Safe to call multiple times (no-op if already connected).
   */
  connect() {
    if (this._client && this._client._sock && !this._client._sock.destroyed) {
      return;
    }
    this._client = new Client();
    this._client.on('ready', () => {
      this._resetBackoff();
      this.emit('connected');
      this._restoreStreams();
    });
    this._client.on('error', (err) => {
      this.emit('disconnected', err);
      this._scheduleReconnect();
    });
    this._client.on('close', () => {
      this.emit('disconnected');
      this._scheduleReconnect();
    });
    this._client.connect(this._config);
  }

  /**
   * disconnect — Close the SSH connection gracefully and stop reconnecting.
   */
  disconnect() {
    this._shouldReconnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._client) {
      try { this._client.end(); } catch (e) {}
      this._client = null;
    }
  }

  /**
   * _scheduleReconnect — Schedule a reconnection attempt using exponential backoff.
   * @private
   */
  _scheduleReconnect() {
    if (!this._shouldReconnect) return;
    this.emit('reconnecting', this._backoffMs);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, this._backoffMs);
    this._backoffMs = Math.min(this._backoffMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
  }

  /**
   * _resetBackoff — Reset the exponential backoff counter after a successful connect.
   * @private
   */
  _resetBackoff() {
    this._backoffMs = BACKOFF_INITIAL_MS;
  }

  // ---------------------------------------------------------------------------
  // Command execution
  // ---------------------------------------------------------------------------

  /**
   * exec — Run a one-shot command and collect its output.
   *
   * @param {string} command
   * @returns {Promise<string>} stdout of the command (stderr is discarded)
   * @throws {Error} If the command exits with a non-zero code or SSH is not connected
   */
  async exec(command) {
    if (!this.isConnected()) {
      throw new Error('SSH not connected');
    }
    return new Promise((resolve, reject) => {
      this._client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        stream.on('data', (data) => { out += data.toString(); });
        stream.stderr.on('data', () => {}); // ignore stderr
        stream.on('close', (code) => {
          if (code === 0) resolve(out);
          else reject(new Error(`Command failed: ${command}`));
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Persistent streams
  // ---------------------------------------------------------------------------

  /**
   * openStream — Open a persistent streaming command (e.g. journalctl -f).
   *
   * The provided `onData` callback is called for each line received.
   * The stream is automatically re-opened on reconnect via the stream factory registry.
   *
   * @param {string}   command     — Shell command to stream
   * @param {Function} onData      — Called with each line (string)
   * @param {Function} [onClose]   — Called when the stream closes
   * @returns {Function} unregister — Call to remove the stream factory (stops auto-reopen)
   */
  openStream(command, onData, onClose) {
    const factory = (client) => {
      client.exec(command, (err, stream) => {
        if (err) return onClose && onClose(err);
        let buf = '';
        stream.on('data', (data) => {
          buf += data.toString();
          let lines = buf.split(/\r?\n/);
          buf = lines.pop();
          for (const line of lines) onData(line);
        });
        stream.on('close', () => { if (onClose) onClose(); });
      });
    };
    this._streamFactories.add(factory);
    if (this.isConnected()) factory(this._client);
    return () => { this._streamFactories.delete(factory); };
  }

  /**
   * _restoreStreams — Re-invoke all registered stream factories after reconnect.
   * @private
   */
  _restoreStreams() {
    for (const factory of this._streamFactories) {
      factory(this._client);
    }
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  /**
   * isConnected — Returns true if the SSH client is currently authenticated.
   * @returns {boolean}
   */
  isConnected() {
    return this._client && this._client._sock && !this._client._sock.destroyed;
  }
}

module.exports = SSHManager;
