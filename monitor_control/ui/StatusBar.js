'use strict';

/**
 * StatusBar.js — Bottom keyboard shortcut hint bar.
 *
 * From SPEC.md:
 *   [c] Config    [r] Refresh    [q] Quit    [Tab] Focus logs
 *
 * This is a purely display widget — actual key binding is handled in index.js
 * and the screen objects.  This module only renders the hint text.
 */

class StatusBar {
  /**
   * @param {blessed.screen} screen
   */
  constructor(screen) {
    this._screen = screen;
    this._widget = null;

    this._createWidget();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * getWidget — Return the blessed widget for layout placement.
   * @returns {blessed.BlessedElement}
   */
  getWidget() {
    return this._widget;
  }

  /**
   * setMessage — Temporarily show a status message (e.g. "Restarting PD…")
   * replacing the hint text for a few seconds, then restore.
   *
   * @param {string}  message     — The message to display
   * @param {number}  [durationMs=3000] — How long to show it before restoring hints
   */
  setMessage(message, durationMs = 3000) {
    this._widget.setContent(message);
    this._screen.render();
    setTimeout(() => {
      this._widget.setContent(this._hint);
      this._screen.render();
    }, durationMs);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _createWidget — Build the footer blessed.box with the shortcut hints.
   *
   * @private
   */
  _createWidget() {
    const blessed = require('blessed');
    this._hint = '  [c] Config    [r] Refresh    [q] Quit    [Tab] Focus logs';
    this._widget = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'gray', bg: 'black' },
      content: this._hint,
    });
  }
  
}

module.exports = StatusBar;
