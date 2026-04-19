'use strict';

/**
 * OutputParsers.js — Pure functions to parse raw SSH command output into typed values.
 *
 * All functions are stateless and throw on unexpected/unparseable input
 * (the SSHPoller catches those errors and emits them as 'error' events).
 *
 * Covered parsers:
 *  - parseCpuTemp     — /sys/class/thermal/thermal_zone0/temp  → °C (number)
 *  - parseCpuUsage    — vmstat output                          → usage % (number)
 *  - parseServiceStatus — systemctl is-active output           → 'active'|'inactive'|'failed'
 *  - parseRtPolicy    — chrt -p output                         → 'SCHED_FIFO/70' | 'SCHED_OTHER/0' | 'not found'
 *  - parseVersion     — git log --format="%h %s"               → short string
 *  - parseOsRelease   — /etc/os-release content                → { name, version }
 *  - parseKernelVersion — uname -r output                      → { version, isRealtime }
 *  - parseCpuGovernor  — cpufreq scaling_governor content      → string[]
 *  - parseGroups       — groups <user> output                  → string[]
 *  - parseRtLimits     — /etc/security/limits.conf grep output → { rtprio, memlock }
 *  - parseSerialPorts  — ls /dev/ttyACM* /dev/ttyUSB* output   → string[]
 *  - parseSudoersCheck — sudo -n output                        → boolean (NOPASSWD detected)
 */

class OutputParsers {
  // ---------------------------------------------------------------------------
  // Runtime screen parsers
  // ---------------------------------------------------------------------------

  /**
   * parseCpuTemp — Parse raw millidegree Celsius value from thermal_zone0/temp.
   *
   * @param {string} stdout — e.g. "54321\n"
   * @returns {number} Temperature in °C (e.g. 54.3)
   */
  static parseCpuTemp(stdout) {
    const val = parseInt(stdout.trim(), 10);
    if (isNaN(val)) throw new Error('Invalid CPU temp');
    return Math.round((val / 1000) * 10) / 10;
  }

  /**
   * parseCpuUsage — Parse CPU usage % from vmstat output.
   *
   * vmstat columns: procs, memory, swap, io, system, cpu
   * The last columns are: us sy id wa st
   * Usage = 100 - idle (id column)
   *
   * @param {string} stdout — Full vmstat output (header + 2 data lines)
   * @returns {number} CPU usage percentage (0–100)
   */
  static parseCpuUsage(stdout) {
    const lines = stdout.trim().split(/\r?\n/);
    const last = lines[lines.length - 1];
    const cols = last.trim().split(/\s+/);
    const idle = parseFloat(cols[cols.length - 5]); // id column
    if (isNaN(idle)) throw new Error('Invalid CPU usage');
    return Math.round(100 - idle);
  }
  /**
   * parseServiceStatus — Parse output of `systemctl is-active <service>`.
   *
   * @param {string} stdout — e.g. "active\n"
   * @returns {'active'|'inactive'|'failed'|string}
   */
  static parseServiceStatus(stdout) {
    // systemctl is-active returns a single word: active, inactive, failed, etc.
    return stdout.trim();
  }

  /**
   * parseRtPolicy — Parse output of `chrt -p <pid>`.
   *
   * Example output:
   *   pid 471's current scheduling policy: SCHED_FIFO
   *   pid 471's current scheduling priority: 6
   *
   * @param {string} stdout
   * @returns {string} e.g. 'SCHED_FIFO/6', 'SCHED_OTHER/0', or 'not found'
   */
  static parseRtPolicy(stdout) {
    // Exemples d'output :
    // pid 471's current scheduling policy: SCHED_FIFO
    // pid 471's current scheduling priority: 6
    // ou bien : chrt: pid 1234: No such process
    const policyMatch = stdout.match(/scheduling policy: (SCHED_\w+)/);
    const prioMatch = stdout.match(/scheduling priority: (\d+)/);
    if (policyMatch && prioMatch) {
      return `${policyMatch[1]}/${prioMatch[1]}`;
    }
    // Si le process n'existe pas ou pas de match
    return 'not found';
  }

  /**
   * parseVersion — Parse output of `git log -1 --format="%h %s"`.
   *
   * @param {string} stdout — e.g. "a3f1d2c fix loop sync\n"
   * @returns {string} Trimmed version string
   */
  static parseVersion(stdout) {
    return stdout.trim();
  }

  // ---------------------------------------------------------------------------
  // Config check screen parsers
  // ---------------------------------------------------------------------------

  /**
   * parseOsRelease — Parse /etc/os-release content.
   *
   * @param {string} stdout — Key=value pairs, one per line
   * @returns {{ name: string, version: string }}
   */
  static parseOsRelease(stdout) {
    const map = {};
    stdout.split(/\r?\n/).forEach(line => {
      const m = line.match(/^(\w+)="?([^"]*)"?$/);
      if (m) map[m[1]] = m[2];
    });
    const name = map['PRETTY_NAME'] || map['NAME'] || '';
    const version = map['VERSION_ID'] || '';
    return { name, version };
  }

  /**
   * parseKernelVersion — Parse output of `uname -r`.
   *
   * @param {string} stdout — e.g. "5.15.32-rt39-v7l+\n"
   * @returns {{ version: string, isRealtime: boolean }}
   */
  static parseKernelVersion(stdout) {
    const version = stdout.trim();
    const isRealtime = /rt/i.test(version);
    return { version, isRealtime };
  }

  /**
   * parseCpuGovernor — Parse the scaling_governor file (one value per core).
   *
   * Chaque ligne = le governor d'un cœur.
   *
   * @param {string} stdout — e.g. "performance\nperformance\n..."
   * @returns {string[]} Array of governor strings, one per CPU core
   */
  static parseCpuGovernor(stdout) {
    return stdout.split(/\r?\n/).filter(l => l.trim() !== '');
  }

  /**
   * parseGroups — Parse output of `groups <user>`.
   *
   * @param {string} stdout — e.g. "patch : patch audio jack\n"
   * @returns {string[]} Array of group names
   */
  static parseGroups(stdout) {
    const parts = stdout.split(':');
    const right = parts.length > 1 ? parts[1] : parts[0];
    return right.trim().split(/\s+/).filter(g => g !== '');
  }

  /**
   * parseRtLimits — Parse grep output from /etc/security/limits.conf.
   *
   * @param {string} stdout — Lines matching rtprio or memlock
   * @returns {{ rtprio: boolean, memlock: boolean }}
   */
  static parseRtLimits(stdout) {
    return {
      rtprio: stdout.includes('rtprio'),
      memlock: stdout.includes('memlock'),
    };
  }

  /**
   * parseSerialPorts — Parse output of `ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null`.
   *
   * @param {string} stdout — Newline-separated device paths
   * @returns {string[]} List of detected serial device paths
   */
  static parseSerialPorts(stdout) {
    return stdout.split(/\r?\n/).filter(l => l.trim() !== '');
  }

  /**
   * parseSudoersCheck — Determine if the user can run systemctl without a password.
   *
   * `sudo -n systemctl status` exits 0 silently if NOPASSWD is configured,
   * or prints "sudo: a password is required" to stderr and exits non-zero.
   *
   * @param {string} stdout  — Combined stdout+stderr of the check command
   * @returns {boolean} true = NOPASSWD detected (ok), false = password required
   */
  static parseSudoersCheck(stdout) {
    return !stdout.includes('password');
  }
}

module.exports = OutputParsers;
