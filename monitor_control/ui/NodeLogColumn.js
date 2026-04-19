'use strict';

/**
 * NodeLogColumn.js — Center column of the Runtime screen (lucibox-node logs).
 *
 * From SPEC.md §"Colonne centrale":
 *  - Source: journalctl -u lucibox-node.service -f -n 100 (persistent SSH stream)
 *  - Button [Restart Node] at the top of the column
 *  - Log line colorization via LogColorizer.colorizeNodeLine()
 *  - Auto-scroll with manual scroll detection (delegated to LogPanel)
 *
 * This class:
 *  1. Creates the blessed column container
 *  2. Creates the [Restart Node] button
 *  3. Creates a LogPanel for the log display
 *  4. Opens the persistent SSH stream via SSHManager
 *  5. Pipes each arriving line through LogColorizer → LogPanel.appendLine()
 */

const LogPanel = require('./LogPanel');
const LogColorizer = require('../modules/LogColorizer');

// journalctl command for node service logs
const NODE_JOURNAL_CMD = 'journalctl -u lucibox-node.service -f -n 100';

class NodeLogColumn {
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
   * startStream — Open the persistent SSH journal stream for node.
   * Called by RuntimeScreen after SSH connects (or reconnects).
   */
  startStream() {
    this.stopStream();
    this._unregisterStream = this._ssh.openStream(
      NODE_JOURNAL_CMD,
      (line) => this._onLine(line),
      () => this._onStreamClose()
    );
  }

  /**
   * stopStream — Unregister the SSH stream (e.g. on disconnect).
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
      left: '25%',
      width: '37.5%',
      height: '100%-2',
      border: 'line',
      label: ' NODE LOGS ',
      style: { bg: 'black', fg: 'white' },
      tags: true,
    });

    // Restart Node button
    this._restartBtn = blessed.button({
      parent: this._container,
      mouse: true,
      keys: true,
      shrink: true,
      padding: { left: 1, right: 1 },
      left: 2,
      top: 1,
      height: 1,
      name: 'restartNode',
      content: '[ Restart Node ]',
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
   * _attachButtonHandler — Wire the [Restart Node] button.
   *
   * @private
   */
  _attachButtonHandler() {
    if (this._restartBtn) {
      this._restartBtn.on('press', () => this._actionRunner.restartNode());
    }
  }

  /**
   * _onLine — Handle a new line from the journal stream.
   *
   * @param {string} line — Raw log line
   * @private
   */
  _onLine(line) {
    // Supprimer tout préfixe journalctl (date, service, pid, etc.)
    const msg = line.replace(/^.*?start-node\.sh\[\d+\]:\s*/, '');
    const colorized = LogColorizer.colorizeNodeLine(msg);
    this._logPanel.appendLine(colorized);
  }

  /**
   * _onStreamClose — Handle stream closure (SSH dropped, service restarted, etc.)
   *
   * @private
   */
  _onStreamClose() {
    // No-op: SSHManager will re-open the stream on reconnect via the factory registry
  }
}

module.exports = NodeLogColumn;
