'use strict';

/**
 * ActionRunner.js — Execute action commands on the RPi over SSH.
 *
 * Actions available (from SPEC.md §"Boutons d'action"):
 *  - restartPd       — sudo systemctl restart lucibox-pd.service
 *  - restartNode     — sudo systemctl restart lucibox-node.service
 *  - rebootRpi       — sudo reboot  (requires confirmation popup)
 *  - gitPull         — git -C /home/patch/lucibox pull  (requires confirmation popup)
 *
 * From IMPL.md §F:
 *  - SSH exec channels have no TTY — a password prompt would fail silently.
 *  - Relies on sudoers NOPASSWD being configured on the RPi.
 *  - If the command exits non-zero, emit 'error' with a visible message.
 *
 * Emits:
 *  - 'start'   (actionName: string)  — Immediately when the action is sent over SSH
 *  - 'success' (actionName: string)  — When the command exits 0
 *  - 'failure' (actionName: string, error: Error) — When exit code is non-zero
 */

const EventEmitter = require('events');

const COMMANDS = {
  restartPd:   'sudo systemctl restart lucibox-pd.service',
  restartNode: 'sudo systemctl restart lucibox-node.service',
  rebootRpi:   'sudo reboot',
  gitPull:     'git -C /home/patch/lucibox pull',
};

class ActionRunner extends EventEmitter {
  /**
   * @param {SSHManager}    ssh           — Shared SSH manager instance
   * @param {StatusPoller}  statusPoller  — Used to trigger a version refresh after gitPull
   */
  constructor(ssh, statusPoller) {
    super();
    this._ssh = ssh;
    this._statusPoller = statusPoller;
  }

  // ---------------------------------------------------------------------------
  // Actions (no confirmation required)
  // ---------------------------------------------------------------------------

  /**
   * restartPd — Restart the lucibox-pd systemd service.
   * @returns {Promise<void>}
   */
  async restartPd() {
    await this._runCommand('restartPd');
  }

  /**
   * restartNode — Restart the lucibox-node systemd service.
   * @returns {Promise<void>}
   */
  async restartNode() {
    await this._runCommand('restartNode');
  }

  // ---------------------------------------------------------------------------
  // Actions (confirmation required — caller must show ConfirmPopup first)
  // ---------------------------------------------------------------------------

  /**
   * rebootRpi — Reboot the Raspberry Pi.
   * Caller is responsible for showing the ConfirmPopup before calling this.
   * @returns {Promise<void>}
   */
  async rebootRpi() {
    await this._runCommand('rebootRpi');
  }

  /**
   * gitPull — Pull the latest code on the RPi, then refresh version display.
   * Caller is responsible for showing the ConfirmPopup before calling this.
   * @returns {Promise<void>}
   */
  async gitPull() {
    await this._runCommand('gitPull');
    if (this._statusPoller && typeof this._statusPoller.refreshVersion === 'function') {
      await this._statusPoller.refreshVersion();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _runCommand — Execute a named SSH command and emit lifecycle events.
   *
   * @param {string} actionName — Key in COMMANDS map
   * @returns {Promise<void>}
   * @private
   */
  async _runCommand(actionName) {
    this.emit('start', actionName);
    const cmd = COMMANDS[actionName];
    try {
      await this._ssh.exec(cmd);
      this.emit('success', actionName);
    } catch (err) {
      this.emit('failure', actionName, err);
    }
  }
}

module.exports = ActionRunner;
