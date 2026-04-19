'use strict';

/**
 * RuntimeScreen.js — The main (default) screen of the Lucibox Monitor TUI.
 *
 * Layout (25% / 37.5% / 37.5% columns, from SPEC.md):
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  LUCIBOX MONITOR — patch@patchbox.local              [SSH Connected] │  ← Header
 *  ├──────────────────┬───────────────────────┬───────────────────────────┤
 *  │  StatusColumn    │  NodeLogColumn         │  PdLogColumn             │
 *  │  (25%)           │  (37.5%)               │  (37.5%)                 │
 *  │                  │                        │                          │
 *  ├──────────────────┴───────────────────────┴───────────────────────────┤
 *  │  [c] Config    [r] Refresh    [q] Quit    [Tab] Focus logs           │  ← StatusBar
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 * Responsibilities:
 *  - Instantiate and lay out all UI sub-components
 *  - Wire StatusPoller events → StatusColumn update methods
 *  - Wire XrunCounter events  → StatusColumn.updateXruns()
 *  - Wire SSHManager events   → Header + stream start/stop
 *  - Handle [r] Refresh key   → statusPoller.refreshAll()
 *  - Handle [Tab] key         → cycle focus between NodeLogColumn and PdLogColumn
 *  - Expose show() / hide() for screen switching in index.js
 */

const Header        = require('../ui/Header');
const StatusBar     = require('../ui/StatusBar');
const StatusColumn  = require('../ui/StatusColumn');
const NodeLogColumn = require('../ui/NodeLogColumn');
const PdLogColumn   = require('../ui/PdLogColumn');
const ConfirmPopup  = require('../ui/ConfirmPopup');
const StatusPoller  = require('../modules/StatusPoller');
const XrunCounter   = require('../modules/XrunCounter');
const ActionRunner  = require('../modules/ActionRunner');

class RuntimeScreen {
  /**
   * @param {blessed.screen} screen
   * @param {SSHManager}     ssh
   * @param {object}         config — { username, host } for the header title
   */
  constructor(screen, ssh, config) {
    this._screen = screen;
    this._ssh    = ssh;
    this._config = config;

    // Track which log column currently has keyboard focus (for Tab cycling)
    // 'node' | 'pd'
    this._focusedLog = 'node';

    // Module instances
    this._statusPoller  = new StatusPoller(ssh);
    this._xrunCounter   = new XrunCounter(ssh);
    this._actionRunner  = new ActionRunner(ssh, this._statusPoller);

    // UI component instances — created in _createComponents()
    this._header         = null;
    this._statusColumn   = null;
    this._nodeLogColumn  = null;
    this._pdLogColumn    = null;
    this._statusBar      = null;
    this._confirmPopup   = null;

    // Root container for this screen — show/hide toggles this box
    this._container = null;

    this._createComponents();
    this._wireEvents();
    this._registerKeys();
  }

  // ---------------------------------------------------------------------------
  // Public API — screen lifecycle
  // ---------------------------------------------------------------------------

  /**
   * show — Make this screen visible and start all pollers and streams.
   */
  show() {
    this._container.show();
    this._statusPoller.start();
    this._xrunCounter.start();
    this._nodeLogColumn.startStream();
    this._pdLogColumn.startStream();
    this._screen.render();
  }

  /**
   * hide — Hide this screen and stop all pollers and streams.
   */
  hide() {
    this._container.hide();
    this._statusPoller.stop();
    this._xrunCounter.stop();
    this._nodeLogColumn.stopStream();
    this._pdLogColumn.stopStream();
  }

  // ---------------------------------------------------------------------------
  // Internal — setup
  // ---------------------------------------------------------------------------

  /**
   * _createComponents — Instantiate all UI and module components and build layout.
   *
   * @private
   */
  _createComponents() {
    const blessed = require('blessed');
    this._container = blessed.box({
      top: 0, left: 0, width: '100%', height: '100%',
      hidden: true,
      style: { bg: 'black' },
    });
    this._screen.append(this._container);

    this._confirmPopup = new ConfirmPopup(this._screen);
    this._header = new Header(this._screen, this._ssh, this._config);
    this._statusBar = new StatusBar(this._screen);
    this._statusColumn = new StatusColumn(this._screen, this._actionRunner, this._confirmPopup);
    this._nodeLogColumn = new NodeLogColumn(this._screen, this._ssh, this._actionRunner);
    this._pdLogColumn = new PdLogColumn(this._screen, this._ssh, this._actionRunner);

    // Layout: header (top), 3 columns (row), statusbar (bottom)
    this._container.append(this._header.getWidget());
    this._container.append(this._statusColumn.getWidget());
    this._container.append(this._nodeLogColumn.getWidget());
    this._container.append(this._pdLogColumn.getWidget());
    this._container.append(this._statusBar.getWidget());
    this._container.append(this._confirmPopup.getWidget ? this._confirmPopup.getWidget() : this._confirmPopup);
  }

  /**
   * _wireEvents — Connect module events to UI updaters.
   *
   * @private
   */
  _wireEvents() {
    // StatusPoller → StatusColumn
    this._statusPoller.on('services',    (s) => this._statusColumn.updateServices(s));
    this._statusPoller.on('cpuTemp',     (t) => this._statusColumn.updateCpuTemp(t));
    this._statusPoller.on('cpuUsage',    (u) => this._statusColumn.updateCpuUsage(u));
    this._statusPoller.on('rtProcesses', (p) => this._statusColumn.updateRtProcesses(p));
    this._statusPoller.on('version',     (v) => this._statusColumn.updateVersion(v));

    // XrunCounter → StatusColumn
    this._xrunCounter.on('update', (c) => this._statusColumn.updateXruns(c));
    this._xrunCounter.on('reset',  ()  => this._statusColumn.updateXruns(0));

    // SSHManager → streams lifecycle
    this._ssh.on('connected', () => {
      this._nodeLogColumn.startStream();
      this._pdLogColumn.startStream();
      this._xrunCounter.start();
      this._statusPoller.start();
    });
    this._ssh.on('disconnected', () => {
      this._nodeLogColumn.stopStream();
      this._pdLogColumn.stopStream();
    });

    // ActionRunner → StatusBar feedback
    this._actionRunner.on('start',   (name) => this._statusBar.setMessage(`${name}…`));
    this._actionRunner.on('success', (name) => this._statusBar.setMessage(`${name}: OK`, 2000));
    this._actionRunner.on('failure', (name, err) => this._statusBar.setMessage(`${name}: ERROR — ${err && err.message ? err.message : err}`, 5000));
  }

  /**
   * _registerKeys — Attach screen-level key bindings specific to RuntimeScreen.
   *
   * @private
   */
  _registerKeys() {
    // [r] — Refresh all pollers immediately
    this._screen.key('r', () => this._statusPoller.refreshAll());

    // [Tab] — Cycle keyboard focus between the two log columns
    this._screen.key('tab', () => this._cycleFocus());
  }

  /**
   * _cycleFocus — Toggle keyboard focus between NodeLogColumn and PdLogColumn.
   *
   * @private
   */
  _cycleFocus() {
    if (this._focusedLog === 'node') {
      this._pdLogColumn.focus();
      this._focusedLog = 'pd';
    } else {
      this._nodeLogColumn.focus();
      this._focusedLog = 'node';
    }
  }
}

module.exports = RuntimeScreen;
