'use strict';

/**
 * StatusColumn.js — Left column of the Runtime screen (25% width).
 *
 * Displays (from SPEC.md):
 *  ┌──────────────────┐
 *  │  STATUS          │
 *  │                  │
 *  │ jack        ✓   │
 *  │ node        ✓   │
 *  │ pd          ✓   │
 *  │                  │
 *  │ CPU Temp: 52°C  │
 *  │ CPU Usage: 23%  │
 *  │ XRUNs: 0        │
 *  │                  │
 *  │ RT Processes:   │
 *  │  pd  SCHED_FF70 │
 *  │  node SCHED_OT  │
 *  │                  │
 *  │ Version:        │
 *  │ a3f1d2c         │
 *  │ "fix loop sync" │
 *  │                  │
 *  │ [ Restart PD ]  │
 *  │ [ Restart Node ]│
 *  │ [ Reboot RPi ]  │
 *  │ [ Git Pull ]    │
 *  └──────────────────┘
 *
 * Each metric is updated independently via its own update method,
 * called by RuntimeScreen when the relevant poller fires.
 */

class StatusColumn {
  /**
   * @param {blessed.screen} screen
   * @param {ActionRunner}   actionRunner  — Passed in so buttons can trigger actions
   * @param {ConfirmPopup}   confirmPopup  — Used by Reboot and Git Pull buttons
   */
  constructor(screen, actionRunner, confirmPopup) {
    this._screen = screen;
    this._actionRunner = actionRunner;
    this._confirmPopup = confirmPopup;

    // Individual blessed element references (set in _createWidgets)
    this._container = null;
    this._serviceLines = {}; // { jack, node, pd } → blessed text elements
    this._cpuTempLine  = null;
    this._cpuUsageLine = null;
    this._xrunLine     = null;
    this._rtPdLine     = null;
    this._rtNodeLine   = null;
    this._versionLine  = null;
    this._buttons      = {}; // { restartPd, restartNode, rebootRpi, gitPull }

    this._createWidgets();
    // TODO: Call this._attachButtonHandlers()
  }

  // ---------------------------------------------------------------------------
  // Public API — metric updaters (called by RuntimeScreen)
  // ---------------------------------------------------------------------------

  /**
   * updateServices — Update the service status indicators.
   *
   * @param {{ jack: string, node: string, pd: string }} statuses
   *   Each value is 'active', 'inactive', or 'failed'.
   */
  updateServices(statuses) {
    for (const name of ['jack', 'node', 'pd']) {
      let state = statuses && statuses[name];
      let icon;
      if (state === 'active') {
        icon = '{green-fg}✓{/green-fg}';
      } else {
        icon = '{red-fg}✗{/red-fg}';
      }
      this._serviceLines[name].setContent(`${name} ${icon}`);
    }
    this._screen.render();
  }

  /**
   * updateCpuTemp — Update the CPU temperature display.
   *
   * @param {number} tempCelsius
   */
  updateCpuTemp(tempCelsius) {
    let color = 'green-fg';
    if (tempCelsius >= 75) color = 'red-fg';
    else if (tempCelsius >= 60) color = 'yellow-fg';
    this._cpuTempLine.setContent(`{${color}}CPU Temp: ${tempCelsius}°C{/${color}}`);
    this._screen.render();
  }

  /**
   * updateCpuUsage — Update the CPU usage display.
   *
   * @param {number} usagePercent  0–100
   */
  updateCpuUsage(usagePercent) {
    let color = 'green-fg';
    if (usagePercent > 80) color = 'red-fg';
    else if (usagePercent > 50) color = 'yellow-fg';
    this._cpuUsageLine.setContent(`{${color}}CPU Usage: ${usagePercent}%{/${color}}`);
    this._screen.render();
  }

  /**
   * updateXruns — Update the XRUN counter display.
   *
   * @param {number} count
   */
  updateXruns(count) {
    const color = count > 0 ? 'red-fg' : 'green-fg';
    this._xrunLine.setContent(`{${color}}XRUNs: ${count}{/${color}}`);
    this._screen.render();
  }

  /**
   * updateRtProcesses — Update the real-time scheduling display.
   *
   * @param {{ pd: string, node: string }} processes
   *   e.g. { pd: 'SCHED_FIFO/70', node: 'SCHED_OTHER/0' }
   */
  updateRtProcesses(processes) {
    // pd
    let pdStr = processes.pd || 'not found';
    let pdColor = 'red-fg';
    if (/SCHED_FIFO/.test(pdStr)) pdColor = 'green-fg';
    else if (/SCHED_OTHER/.test(pdStr)) pdColor = 'yellow-fg';
    this._rtPdLine.setContent(`{${pdColor}}pd: ${pdStr}{/${pdColor}}`);
    // node
    let nodeStr = processes.node || 'not found';
    let nodeColor = 'red-fg';
    if (/SCHED_FIFO/.test(nodeStr)) nodeColor = 'green-fg';
    else if (/SCHED_OTHER/.test(nodeStr)) nodeColor = 'yellow-fg';
    this._rtNodeLine.setContent(`{${nodeColor}}node: ${nodeStr}{/${nodeColor}}`);
    this._screen.render();
  }

  /**
   * updateVersion — Update the git version display.
   *
   * @param {string} versionString — e.g. 'a3f1d2c fix loop sync'
   */
  updateVersion(versionString) {
    if (!versionString) {
      this._versionLine.setContent('Version: --');
    } else {
      const [hash, ...msg] = versionString.split(' ');
      const message = msg.join(' ');
      this._versionLine.setContent(`Version:\n{bold}${hash}{/bold}\n${message}`);
    }
    this._screen.render();
  }

  /**
   * getWidget — Return the container box for layout attachment.
   * @returns {blessed.BlessedElement}
   */
  getWidget() {
    return this._container;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _createWidgets — Build all the blessed sub-elements inside the column.
   *
   * @private
   */
  _createWidgets() {
    const blessed = require('blessed');
    // Container
    this._container = blessed.box({
      top: 1,
      left: 0,
      width: '25%',
      height: '100%-2',
      tags: true,
      style: { bg: 'black', fg: 'white' },
      border: 'line',
      label: ' STATUS ',
    });

    // Service lines
    const serviceNames = ['jack', 'node', 'pd'];
    this._serviceLines = {};
    serviceNames.forEach((name, i) => {
      this._serviceLines[name] = blessed.text({
        parent: this._container,
        top: 2 + i,
        left: 2,
        height: 1,
        tags: true,
        content: `${name} {green-fg}✓{/green-fg}`,
      });
    });

    // Metrics
    this._cpuTempLine = blessed.text({
      parent: this._container,
      top: 6,
      left: 2,
      height: 1,
      tags: true,
      content: 'CPU Temp: --°C',
    });
    this._cpuUsageLine = blessed.text({
      parent: this._container,
      top: 7,
      left: 2,
      height: 1,
      tags: true,
      content: 'CPU Usage: --%',
    });
    this._xrunLine = blessed.text({
      parent: this._container,
      top: 8,
      left: 2,
      height: 1,
      tags: true,
      content: 'XRUNs: --',
    });

    // RT Processes
    this._rtPdLine = blessed.text({
      parent: this._container,
      top: 10,
      left: 2,
      height: 1,
      tags: true,
      content: 'pd: --',
    });
    this._rtNodeLine = blessed.text({
      parent: this._container,
      top: 11,
      left: 2,
      height: 1,
      tags: true,
      content: 'node: --',
    });

    // Version
    this._versionLine = blessed.text({
      parent: this._container,
      top: 13,
      left: 2,
      height: 2,
      tags: true,
      content: 'Version: --',
    });

    // Buttons
    const buttonSpecs = [
      { key: 'restartPd', label: 'Restart PD', top: 16 },
      { key: 'restartNode', label: 'Restart Node', top: 17 },
      { key: 'rebootRpi', label: 'Reboot RPi', top: 18 },
      { key: 'gitPull', label: 'Git Pull', top: 19 },
    ];
    this._buttons = {};
    buttonSpecs.forEach(spec => {
      this._buttons[spec.key] = blessed.button({
        parent: this._container,
        mouse: true,
        keys: true,
        shrink: true,
        padding: { left: 1, right: 1 },
        left: 2,
        top: spec.top,
        height: 1,
        name: spec.key,
        content: `[ ${spec.label} ]`,
        style: {
          fg: 'white',
          bg: 'blue',
          focus: { bg: 'green' },
          hover: { bg: 'cyan' },
        },
      });
    });

    this._attachButtonHandlers();
  }

  /**
   * _attachButtonHandlers — Wire the button 'press' events to ActionRunner.
   *
   * @private
   */
  _attachButtonHandlers() {
    if (!this._buttons) return;
    this._buttons.restartPd.on('press', () => this._actionRunner.restartPd());
    this._buttons.restartNode.on('press', () => this._actionRunner.restartNode());
    this._buttons.rebootRpi.on('press', () => {
      this._confirmPopup.ask('Reboot RPi').then(confirmed => {
        if (confirmed) this._actionRunner.rebootRpi();
      });
    });
    this._buttons.gitPull.on('press', () => {
      this._confirmPopup.ask('Git Pull').then(confirmed => {
        if (confirmed) this._actionRunner.gitPull();
      });
    });
  }
}

module.exports = StatusColumn;
