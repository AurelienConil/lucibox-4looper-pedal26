'use strict';

/**
 * PdLogColumn.js — Right column of the Runtime screen (lucibox-pd logs).
 *
 * From SPEC.md §"Colonne droite":
 *  - Source: journalctl -u lucibox-pd.service -f -n 100 (persistent SSH stream)
 *  - Button [Restart PD] at the top of the column
 *  - Log line colorization via LogColorizer.colorizePdLine()
 *  - Auto-scroll with manual scroll detection (delegated to LogPanel)
 *
 * Coloring rules (SPEC.md):
 *   - line contains 'error:' or 'Error' → red
 *   - line contains 'print:'            → white
 *   - other                             → cyan/grey
 *
 * Mirrors NodeLogColumn.js in structure; differs only in SSH command,
 * colorizer function, and button target.
 */

const LogPanel = require('./LogPanel');
const LogColorizer = require('../modules/LogColorizer');

// journalctl command for pd service logs
const PD_JOURNAL_CMD = 'journalctl -u lucibox-pd.service -f -n 100';

class PdLogColumn {
  /**
   * @param {blessed.screen} screen
   * @param {SSHManager}     ssh
   * @param {ActionRunner}   actionRunner
   */
  constructor(screen, ssh, actionRunner) {
    this._screen = screen;
    this._ssh = ssh;
    this._actionRunner = actionRunner;

    // Stream unregister function — stored so we can clean up
    this._unregisterStream = null;

    // Blessed widget references
    this._container  = null;
    this._logPanel   = null;
    this._restartBtn = null;

    this._createWidgets();
    // TODO: Call this._attachButtonHandler()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * startStream — Open the persistent SSH journal stream for pd.
   * Called by RuntimeScreen after SSH connects (or reconnects).
   */
  startStream() {
    this.stopStream();
    this._unregisterStream = this._ssh.openStream(
      PD_JOURNAL_CMD,
      (line) => this._onLine(line),
      () => this._onStreamClose()
    );
  }

  /**
   * stopStream — Unregister the SSH stream.
   */
  stopStream() {
    if (this._unregisterStream) {
      this._unregisterStream();
      this._unregisterStream = null;
    }
  }

  /**
   * getWidget — Return the container for layout placement.
   * @returns {blessed.BlessedElement}
   */
  getWidget() {
    return this._container;
  }

  focus() {
    if (this._logPanel && this._logPanel.focus) {
      this._logPanel.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _createWidgets — Build the column container, button, and LogPanel.
   *
   * @private
   */
  _createWidgets() {
    const blessed = require('blessed');

    // Container for the column
    this._container = blessed.box({
      top: 1,
      left: '62.5%',
      width: '37.5%',
      height: '100%-2',
      border: 'line',
      label: ' PD LOGS ',
      style: { bg: 'black', fg: 'white' },
      tags: true,
    });

    // Restart PD button
    this._restartBtn = blessed.button({
      parent: this._container,
      mouse: true,
      keys: true,
      shrink: true,
      padding: { left: 1, right: 1 },
      left: 2,
      top: 1,
      height: 1,
      name: 'restartPd',
      content: '[ Restart PD ]',
      style: {
        fg: 'white',
        bg: 'blue',
        focus: { bg: 'green' },
        hover: { bg: 'cyan' },
      },
    });

    // LogPanel
    this._logPanel = new LogPanel(this._screen, {
      parent: this._container,
      top: 3,
      left: 1,
      width: '98%',
      height: '100%-4',
      label: '',
    });
    this._container.append(this._logPanel.getWidget());

    this._attachButtonHandler();
  }

  /**
   * _attachButtonHandler — Wire the [Restart PD] button.
   *
   * @private
   */
  _attachButtonHandler() {
    if (this._restartBtn) {
      this._restartBtn.on('press', () => this._actionRunner.restartPd());
    }
  }

  /**
   * _onLine — Handle a new line from the journal stream.
   *
   * @param {string} line — Raw log line
   * @private
   */
  _onLine(line) {
    // Supprimer le préfixe journalctl si présent
    const msg = line.replace(/^.*?autostart\.sh\[\d+\]:\s*/, '');
    const colorized = LogColorizer.colorizePdLine(msg);
    this._logPanel.appendLine(colorized);
  }

  /**
   * _onStreamClose — Handle stream closure.
   *
   * @private
   */
  _onStreamClose() {
    // No-op: SSHManager handles stream restoration on reconnect
  }
}

module.exports = PdLogColumn;
