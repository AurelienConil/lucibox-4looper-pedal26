'use strict';

/**
 * LogPanel.js — Scrollable log panel widget with auto-scroll management.
 *
 * Wraps a blessed `log` or `list` box with the following behaviour (SPEC.md + IMPL.md):
 *
 *  Auto-scroll:
 *   - New lines are appended and the panel scrolls to the bottom automatically.
 *   - If the user manually scrolls UP (wheel-up, arrow-up, PgUp) → auto-scroll is suspended.
 *   - Auto-scroll resumes when the user scrolls back to the bottom (wheel-down, End key).
 *
 *  Line buffering (IMPL.md §C):
 *   - At startup, journalctl -n 100 delivers 100 lines at once.
 *   - Lines are buffered internally and flushed to the widget every FLUSH_INTERVAL_MS
 *     to avoid triggering a re-render on every line.
 *
 *  Coloring:
 *   - Lines are expected to arrive pre-colored (with blessed tags) from LogColorizer.
 *   - The widget is created with `tags: true`.
 */

const blessed = require('blessed');

// Interval between UI flushes when receiving bursts of lines (ms)
const FLUSH_INTERVAL_MS = 50;

class LogPanel {
  /**
   * @param {blessed.screen} screen  — Parent blessed screen
   * @param {object}         opts    — blessed box position/size options
   * @param {string}         [opts.label]
   * @param {object}         [opts.top | left | width | height | ...]
   */
  constructor(screen, opts) {
    this._screen = screen;
    this._userScrolled = false;
    this._lineBuffer = [];
    this._flushTimer = null;
    // Création du widget log scrollable
    this._box = blessed.log({
      parent: opts.parent || null,
      top: opts.top,
      left: opts.left,
      width: opts.width,
      height: opts.height,
      label: opts.label || '',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      border: 'line',
      style: { fg: 'white', bg: 'black', border: { fg: 'grey' }, focus: { border: { fg: 'yellow' } } },
    });
    this._attachScrollListeners();
    this._startFlushTimer();
  }

  getWidget() {
    return this._box;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * appendLine — Buffer a new (optionally pre-colored) log line.
   * Actual rendering is deferred to the next flush tick.
   *
   * @param {string} line — Plain or blessed-tagged log line
   */
  appendLine(line) {
    this._lineBuffer.push(line);
  }

  /**
   * clear — Empty the log panel contents.
   */
  clear() {
    this._lineBuffer = [];
    this._box.setContent('');
    this._screen.render();
  }

  /**
   * focus — Give keyboard focus to this panel (for manual scroll).
   */
  focus() {
    if (this._box && this._box.focus) {
      this._box.focus();
    }
  }

  /**
   * getBox — Return the underlying blessed widget (for layout placement).
   * @returns {blessed.Widgets.Log}
   */
  getBox() {
    return this._box;
  }

  // ---------------------------------------------------------------------------
  // Internal — flush
  // ---------------------------------------------------------------------------

  /**
   * _startFlushTimer — Start the 50ms interval that drains the line buffer.
   * @private
   */
  _startFlushTimer() {
    if (this._flushTimer) clearInterval(this._flushTimer);
    this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
  }

  /**
   * _flush — Append all buffered lines to the blessed widget, then render.
   * @private
   */
  _flush() {
    if (!this._lineBuffer.length) return;
    for (const line of this._lineBuffer) {
      this._box.log(line);
    }
    this._lineBuffer = [];
    if (!this._userScrolled) {
      this._box.setScrollPerc(100);
    }
    this._screen.render();
  }

  // ---------------------------------------------------------------------------
  // Internal — scroll detection (IMPL.md §D)
  // ---------------------------------------------------------------------------

  /**
   * _attachScrollListeners — Detect manual scroll (suspend auto-scroll) and
   * return-to-bottom (resume auto-scroll).
   * @private
   */
  _attachScrollListeners() {
    this._box.on('wheelup', () => { this._userScrolled = true; });
    this._box.key(['up', 'pageup'], () => { this._userScrolled = true; });
    this._box.on('wheeldown', () => {
      if (this._isAtBottom()) this._userScrolled = false;
    });
    this._box.key(['end', 'down'], () => {
      if (this._isAtBottom()) this._userScrolled = false;
    });
  }

  /**
   * _isAtBottom — Return true if the scroll position is at (or near) the bottom.
   * @returns {boolean}
   * @private
   */
  _isAtBottom() {
    return this._box.getScrollPerc() >= 99;
  }
}

module.exports = LogPanel;
