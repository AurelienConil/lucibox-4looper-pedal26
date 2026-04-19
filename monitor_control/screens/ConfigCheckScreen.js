'use strict';

/**
 * ConfigCheckScreen.js — System diagnostic screen (Screen 2).
 *
 * From SPEC.md §"Écran 2 — Config System Check":
 *  - Accessible via [c] key from Runtime, or automatically on first run
 *  - Returns to Runtime via [Esc] or [→ Runtime] button
 *
 * Layout — scrollable list, each item has a status icon + description:
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  LUCIBOX — System Config Check            [ → Runtime ] │
 *  ├─────────────────────────────────────────────────────────┤
 *  │  OS          ✓  Debian GNU/Linux 11 (bullseye)         │
 *  │  Kernel      ✓  5.15.32-rt39-v7l+  (PREEMPT RT)       │
 *  │  CPU Govnr   ✓  cpu0: performance  …                   │
 *  │  Groups      ✓  audio  ✓  jack                         │
 *  │  RT Limits   ✓  rtprio  ✓  memlock                     │
//  │  Services    ✓  jack  ✓  node  ✓  pd                   │
//  │  Serial      ✓  /dev/ttyACM0                           │
//  │  Sudoers     ✓  NOPASSWD systemctl                     │
//  │                                                         │
//  │  [ Refresh ]                    [ → Runtime ]           │
//  └─────────────────────────────────────────────────────────┘
//
// Status icon meaning (SPEC.md):
//  ✓ green  — OK
//  ✗ red    — Problem
//  ⚠ yellow — Warning / unexpected value
//
// Checks performed and commands (from SPEC.md §"Checks effectués"):
//  - OS           : cat /etc/os-release
//  - Kernel       : uname -r
//  - CPU Governor : cat /sys/devices/system/cpu(star)/cpufreq/scaling_governor
//  - Groups       : groups patch
//  - RT Limits    : grep -E 'rtprio|memlock' /etc/security/limits.conf
//  - Services     : systemctl is-active jack / lucibox-node / lucibox-pd
//  - Serial port  : ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
//  - Sudoers      : sudo -n systemctl status 2>&1
 */

const OutputParsers = require('../modules/OutputParsers');

// SSH commands for each check
const CHECKS = {
  os:          'cat /etc/os-release',
  kernel:      'uname -r',
  cpuGovernor: 'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor',
  groups:      'groups patch',
  rtLimits:    "grep -E 'rtprio|memlock' /etc/security/limits.conf",
  serviceJack: 'systemctl is-active jack.service',
  serviceNode: 'systemctl is-active lucibox-node.service',
  servicePd:   'systemctl is-active lucibox-pd.service',
  serial:      'ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null',
  sudoers:     'sudo -n systemctl status 2>&1; true',
};

class ConfigCheckScreen {
  /**
   * @param {blessed.screen} screen
   * @param {SSHManager}     ssh
   * @param {Function}       onBack  — Callback to return to RuntimeScreen
   */
  constructor(screen, ssh, onBack) {
    this._screen = screen;
    this._ssh    = ssh;
    this._onBack = onBack;

    // Container widget — show/hide controls screen visibility
    this._container = null;

    // The scrollable results list widget
    this._resultsList = null;

    // Buttons
    this._refreshBtn  = null;
    this._runtimeBtn  = null;

    this._createWidgets();
    this._attachHandlers();
  }

  // ---------------------------------------------------------------------------
  // Public API — screen lifecycle
  // ---------------------------------------------------------------------------

  /**
   * show — Make this screen visible and run all checks.
   */
  show() {
    this._container.show();
    this.runChecks();
    this._screen.render();
  }

  /**
   * hide — Hide this screen.
   */
  hide() {
    this._container.hide();
  }

  // ---------------------------------------------------------------------------
  // Checks
  // ---------------------------------------------------------------------------

  /**
   * runChecks — Execute all diagnostic checks over SSH and populate the list.
   * Each check runs independently; the list updates as results arrive.
   *
   * @returns {Promise<void>}
   */
  async runChecks() {
    this._clearResults();
    this._addResult('…', 'warn', 'Running checks…');
    this._screen.render();

    // Run all checks in parallel
    const results = await Promise.allSettled([
      this._ssh.exec(CHECKS.os),
      this._ssh.exec(CHECKS.kernel),
      this._ssh.exec(CHECKS.cpuGovernor),
      this._ssh.exec(CHECKS.groups),
      this._ssh.exec(CHECKS.rtLimits),
      this._ssh.exec(CHECKS.serviceJack),
      this._ssh.exec(CHECKS.serviceNode),
      this._ssh.exec(CHECKS.servicePd),
      this._ssh.exec(CHECKS.serial),
      this._ssh.exec(CHECKS.sudoers),
    ]);
    this._clearResults();
    // OS
    try {
      const os = OutputParsers.parseOsRelease(results[0].value);
      this._addResult('OS', 'ok', `${os.name} ${os.version}`);
    } catch {
      this._addResult('OS', 'fail', 'Could not parse');
    }
    // Kernel
    try {
      const kernel = OutputParsers.parseKernelVersion(results[1].value);
      this._addResult('Kernel', kernel.isRealtime ? 'ok' : 'warn', `${kernel.version}${kernel.isRealtime ? ' (PREEMPT RT)' : ''}`);
    } catch {
      this._addResult('Kernel', 'fail', 'Could not parse');
    }
    // CPU Governor
    try {
      const govs = OutputParsers.parseCpuGovernor(results[2].value);
      const allPerf = govs.every((g) => g === 'performance');
      this._addResult('CPU Governor', allPerf ? 'ok' : 'warn', govs.join('  '));
    } catch {
      this._addResult('CPU Governor', 'fail', 'Could not parse');
    }
    // Groups
    try {
      const groups = OutputParsers.parseGroups(results[3].value);
      const hasAudio = groups.includes('audio');
      const hasJack = groups.includes('jack');
      let status = (hasAudio && hasJack) ? 'ok' : 'fail';
      this._addResult('Groups', status, groups.join('  '));
    } catch {
      this._addResult('Groups', 'fail', 'Could not parse');
    }
    // RT Limits
    try {
      const rt = OutputParsers.parseRtLimits(results[4].value);
      let status = (rt.rtprio && rt.memlock) ? 'ok' : 'fail';
      this._addResult('RT Limits', status, `${rt.rtprio ? 'rtprio' : ''}  ${rt.memlock ? 'memlock' : ''}`.trim());
    } catch {
      this._addResult('RT Limits', 'fail', 'Could not parse');
    }
    // Services
    try {
      const jack = OutputParsers.parseServiceStatus(results[5].value);
      const node = OutputParsers.parseServiceStatus(results[6].value);
      const pd   = OutputParsers.parseServiceStatus(results[7].value);
      let status = (jack === 'active' && node === 'active' && pd === 'active') ? 'ok' : 'fail';
      this._addResult('Services', status, `jack: ${jack}  node: ${node}  pd: ${pd}`);
    } catch {
      this._addResult('Services', 'fail', 'Could not parse');
    }
    // Serial
    try {
      const serials = OutputParsers.parseSerialPorts(results[8].value);
      let status = serials.length > 0 ? 'ok' : 'fail';
      this._addResult('Serial', status, serials.join('  ') || 'Not found');
    } catch {
      this._addResult('Serial', 'fail', 'Could not parse');
    }
    // Sudoers
    try {
      const sudoers = OutputParsers.parseSudoersCheck(results[9].value);
      this._addResult('Sudoers', sudoers ? 'ok' : 'fail', sudoers ? 'NOPASSWD systemctl' : 'Password required');
    } catch {
      this._addResult('Sudoers', 'fail', 'Could not parse');
    }
    this._screen.render();
  }

  // ---------------------------------------------------------------------------
  // Internal — result rendering
  // ---------------------------------------------------------------------------

  /**
   * _addResult — Append a single check result line to the results list.
   *
   * @param {string} section — Section label (e.g. 'OS', 'Kernel', 'Services')
   * @param {'ok'|'warn'|'fail'} status
   * @param {string} text    — Human-readable result string
   * @private
   */
  _addResult(section, status, text) {
    let icon = '?';
    if (status === 'ok') icon = '{green-fg}✓{/green-fg}';
    else if (status === 'warn') icon = '{yellow-fg}⚠{/yellow-fg}';
    else if (status === 'fail') icon = '{red-fg}✗{/red-fg}';
    const line = `${icon}  ${section}  ${text}`;
    this._resultsList.addItem(line);
    this._screen.render();
  }

  /**
   * _clearResults — Empty the results list.
   * @private
   */
  _clearResults() {
    this._resultsList.clearItems();
  }

  // ---------------------------------------------------------------------------
  // Internal — widget creation
  // ---------------------------------------------------------------------------

  /**
   * _createWidgets — Build the screen container, results list, and buttons.
   *
   * @private
   */
  _createWidgets() {
    const blessed = require('blessed');
    this._container = blessed.box({
      top: 0, left: 0, width: '100%', height: '100%',
      hidden: true,
      style: { bg: 'black' },
    });
    this._screen.append(this._container);

    // Header
    blessed.box({
      parent: this._container,
      top: 0, left: 0, width: '100%', height: 3,
      content: 'LUCIBOX — System Config Check            [ → Runtime ]',
      tags: true,
      style: { fg: 'white', bg: 'blue' },
    });

    // Results list
    this._resultsList = blessed.list({
      parent: this._container,
      top: 3, left: 0, width: '100%', height: '80%',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        selected: { bg: 'gray' },
        item: { fg: 'white' },
      },
      scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'white' } },
    });

    // Buttons
    this._refreshBtn = blessed.button({
      parent: this._container,
      bottom: 0, left: 2, width: 12, height: 3,
      content: '[ Refresh ]',
      style: { fg: 'white', bg: 'green', focus: { bg: 'red' } },
      align: 'center', valign: 'middle',
    });
    this._runtimeBtn = blessed.button({
      parent: this._container,
      bottom: 0, right: 2, width: 16, height: 3,
      content: '[ → Runtime ]',
      style: { fg: 'white', bg: 'blue', focus: { bg: 'red' } },
      align: 'center', valign: 'middle',
    });
  }
  



  _attachHandlers() {
    this._refreshBtn.on('press', () => this.runChecks());
    this._runtimeBtn.on('press', () => this._onBack && this._onBack());
    this._container.key(['escape'], () => this._onBack && this._onBack());
  }
  
}

module.exports = ConfigCheckScreen;
