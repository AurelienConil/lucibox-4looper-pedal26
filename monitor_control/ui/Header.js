'use strict';

/**
 * Header.js — Top header bar showing app title and SSH connection status.
 *
 * From SPEC.md layout:
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  LUCIBOX MONITOR — patch@patchbox.local             [SSH Connected] │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Connection status badge (from IMPL.md §E):
 *   - [SSH Connected]      — green
 *   - [Reconnecting…]      — yellow
 *   - [SSH Error]          — red (bold)
 *
 * Listens to SSHManager events to update the badge automatically.
 */

class Header {
  /**
   * @param {blessed.screen} screen
   * @param {SSHManager}     ssh
   * @param {object}         config   — { username, host } for the title string
   */
  constructor(screen, ssh, config) {
    this._screen = screen;
    this._ssh = ssh;
    this._config = config;

    // blessed widget reference
    this._widget = null;

    this._createWidget();
    // TODO: Call this._listenToSSH()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * getWidget — Return the blessed widget for layout attachment.
   * @returns {blessed.BlessedElement}
   */
  getWidget() {
    return this._widget;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _createWidget — Build the header blessed.box.
   *
   * @private
   */
  _createWidget() {
    const blessed = require('blessed');
    this._status = 'connected';
    this._widget = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'white', bg: 'blue', bold: true },
      content: this._buildContent(this._status),
    });
    this._listenToSSH();
  }

  /**
   * _listenToSSH — Subscribe to SSHManager events to update the status badge.
   *
   * @private
   */
  _listenToSSH() {
    if (!this._ssh || !this._ssh.on) return;
    this._ssh.on('connected',     () => this._setStatus('connected'));
    this._ssh.on('disconnected',  () => this._setStatus('disconnected'));
    this._ssh.on('reconnecting',  () => this._setStatus('reconnecting'));
    this._ssh.on('error',         () => this._setStatus('error'));
  }

  /**
   * _setStatus — Update the connection badge text and color, then re-render.
   *
   * @param {'connected'|'disconnected'|'reconnecting'|'error'} status
   * @private
   */
  _setStatus(status) {
    this._status = status;
    this._widget.setContent(this._buildContent(status));
    this._screen.render();
  }

  /**
   * _buildContent — Compose the full header string (title + right-aligned badge).
   *
   * @param {string} badge — e.g. '{green-fg}[SSH Connected]{/green-fg}'
   * @returns {string}
   * @private
   */
  _buildContent(status) {
    let badge = '';
    if (status === 'connected') badge = '{green-fg}[SSH Connected]{/green-fg}';
    else if (status === 'reconnecting') badge = '{yellow-fg}[Reconnecting…]{/yellow-fg}';
    else if (status === 'error') badge = '{red-fg}{bold}[SSH Error]{/bold}{/red-fg}';
    else badge = '{red-fg}[SSH Disconnected]{/red-fg}';
    const user = this._config && this._config.username ? this._config.username : 'patch';
    const host = this._config && this._config.host ? this._config.host : 'patchbox.local';
    let left = `  LUCIBOX MONITOR — ${user}@${host}`;
    // Pad right to fill line
    const total = left.length + badge.replace(/{[^}]+}/g, '').length;
    const pad = Math.max(0, (this._screen.width || 80) - total - 2);
    return left + ' '.repeat(pad) + badge;
  }
  
}

module.exports = Header;
