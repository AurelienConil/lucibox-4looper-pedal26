'use strict';

/**
 * ConfirmPopup.js — Modal confirmation dialog (Yes / No).
 *
 * Used for destructive actions: Reboot RPi, Git Pull (SPEC.md §"Popups de confirmation").
 *
 * Behaviour:
 *  - Centered on the screen
 *  - Displays a message: "Confirm: <action>?"
 *  - Two buttons: [No] (focused by default, fail-safe) and [Yes]
 *  - Resolves a Promise<boolean> when the user selects an option or presses Escape
 *  - Returns focus to the previous element after closing
 *
 * Usage:
 *   const popup = new ConfirmPopup(screen);
 *   const confirmed = await popup.ask('Reboot RPi');
 *   if (confirmed) { ... }
 */

const blessed = require('blessed');

class ConfirmPopup {
  /**
   * @param {blessed.screen} screen — Parent blessed screen
   */
  constructor(screen) {
    this._screen = screen;

    // The popup box (hidden until ask() is called)
    this._box = null;

    // TODO: Create the blessed box widget:
    //   - border: 'line', padding: 1
    //   - centered, fixed size (e.g. 40 wide × 8 tall)
    //   - hidden: true by default
    //   - tags: true for color support
    this._createWidget();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * ask — Show the popup with a confirmation message and wait for user input.
   *
   * @param {string} actionLabel — Short description of the action, e.g. 'Reboot RPi'
   * @returns {Promise<boolean>} true = Yes selected, false = No selected or Escaped
   */
  ask(actionLabel) {
    return new Promise((resolve) => {
      this._box.setContent(`{center}Confirm: ${actionLabel}?{/center}`);
      this._box.show();
      this._screen.render();
      this._noButton.focus();
      const cleanup = () => {
        this._box.hide();
        this._screen.render();
        this._noButton.removeAllListeners('press');
        this._yesButton.removeAllListeners('press');
        this._screen.removeListener('keypress', onKeyPress);
      };
      this._noButton.on('press', () => { cleanup(); resolve(false); });
      this._yesButton.on('press', () => { cleanup(); resolve(true); });
      const onKeyPress = (ch, key) => {
        if (key.name === 'escape') { cleanup(); resolve(false); }
      };
      this._screen.on('keypress', onKeyPress);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * _createWidget — Build the blessed box and button widgets.
   * @private
   */
  _createWidget() {
    // Popup box
    this._box = blessed.box({
      parent: this._screen,
      top: 'center',
      left: 'center',
      width: 40,
      height: 8,
      border: 'line',
      padding: 1,
      hidden: true,
      tags: true,
      style: { bg: 'black', fg: 'white', border: { fg: 'yellow' } },
    });
    // No button
    this._noButton = blessed.button({
      parent: this._box,
      mouse: true,
      keys: true,
      shrink: true,
      left: 10,
      top: 5,
      width: 8,
      height: 1,
      name: 'no',
      content: '[ No ]',
      style: {
        fg: 'white',
        bg: 'red',
        focus: { bg: 'yellow' },
        hover: { bg: 'magenta' },
      },
    });
    // Yes button
    this._yesButton = blessed.button({
      parent: this._box,
      mouse: true,
      keys: true,
      shrink: true,
      left: 22,
      top: 5,
      width: 8,
      height: 1,
      name: 'yes',
      content: '[ Yes ]',
      style: {
        fg: 'white',
        bg: 'green',
        focus: { bg: 'yellow' },
        hover: { bg: 'magenta' },
      },
    });
  }

  getWidget() {
    return this._box;
  }
}

module.exports = ConfirmPopup;
