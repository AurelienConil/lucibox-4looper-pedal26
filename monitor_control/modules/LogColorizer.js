'use strict';

/**
 * LogColorizer.js — Colorize log lines for display in blessed log panels.
 *
 * Applies blessed color tags ({red-fg}, {yellow-fg}, etc.) to log lines
 * based on their content.  Each log source (node, pd) has its own set of
 * coloring rules.
 *
 * blessed color tag reference:
 *   {red-fg}…{/red-fg}     {yellow-fg}…{/yellow-fg}
 *   {green-fg}…{/green-fg} {cyan-fg}…{/cyan-fg}
 *   {grey-fg}…{/grey-fg}   (white = default, no tag needed)
 *
 * Rules from SPEC.md:
 *
 *  Node logs:
 *    [ERROR]   → red
 *    [WARN]    → yellow
 *    [INFO]    → light green
 *    [VERBOSE] → grey
 *    other     → white (no tag)
 *
 *  PD logs:
 *    contains 'error:' or 'Error' → red
 *    contains 'print:'             → white (no tag)
 *    other                         → cyan/grey
 */

class LogColorizer {
  /**
   * colorizeNodeLine — Apply coloring rules for lucibox-node journal output.
   *
   * @param {string} line — Raw log line from journalctl
   * @returns {string} Line wrapped in blessed color tags
   */
  static colorizeNodeLine(line) {
    if (line.includes('[ERROR]'))   return LogColorizer._wrap(line, 'red');
    if (line.includes('[WARN]'))    return LogColorizer._wrap(line, 'yellow');
    if (line.includes('[INFO]'))    return LogColorizer._wrap(line, 'green');
    if (line.includes('[VERBOSE]')) return LogColorizer._wrap(line, 'grey');
    return line;
  }

  /**
   * colorizePdLine — Apply coloring rules for lucibox-pd journal output.
   *
   * @param {string} line — Raw log line from journalctl
   * @returns {string} Line wrapped in blessed color tags
   */
  static colorizePdLine(line) {
    if (/error:/i.test(line) || line.includes('Error')) return LogColorizer._wrap(line, 'red');
    if (line.includes('print:')) return line;
    return LogColorizer._wrap(line, 'cyan');
  }

  /**
   * _wrap — Helper: surround text with a blessed color tag pair.
   *
   * @param {string} text
   * @param {string} color — e.g. 'red', 'yellow', 'green', 'cyan', 'grey'
   * @returns {string}
   * @private
   */
  static _wrap(text, color) {
    return `{${color}-fg}${text}{/${color}-fg}`;
  }
}

module.exports = LogColorizer;
