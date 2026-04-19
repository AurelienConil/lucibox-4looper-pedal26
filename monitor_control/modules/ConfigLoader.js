'use strict';

/**
 * ConfigLoader.js — Load and save the local SSH configuration file.
 *
 * The config file `monitor_config.json` lives next to this project on the Mac.
 * It is NOT committed to git (see .gitignore).
 *
 * Expected shape:
 * {
 *   "host":     "patchbox.local",
 *   "port":     22,
 *   "username": "patch",
 *   "password": "raspberry"
 * }
 *
 * Responsibilities:
 *  - Load the file on startup
 *  - Validate that all required fields are present
 *  - If the file is missing or incomplete, return null so the caller
 *    (index.js) can display the config form
 *  - Save a new config object to disk after the user fills the form
 */

const fs = require('fs');
const path = require('path');

// Path to the config file, relative to the monitor_control directory
const CONFIG_PATH = path.join(__dirname, '..', 'monitor_config.json');

// Fields required for a valid config
const REQUIRED_FIELDS = ['host', 'port', 'username', 'password'];

class ConfigLoader {
  /**
   * load — Read and validate monitor_config.json.
   *
   * @returns {Promise<object|null>} Parsed config object, or null if missing/invalid.
   */
  static async load() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return null;
      const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
      const config = JSON.parse(raw);
      if (!this.validate(config)) return null;
      return config;
    } catch (e) {
      return null;
    }
  }

  /**
   * save — Write a config object to monitor_config.json.
   *
   * @param {object} config
   * @returns {Promise<void>}
   */
  static async save(config) {
    if (!this.validate(config)) {
      throw new Error('Invalid config: missing required fields');
    }
    const json = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(CONFIG_PATH, json, 'utf8');
  }

  /**
   * validate — Check that all required fields are present and non-empty.
   *
   * @param {object} config
   * @returns {boolean}
   */
  static validate(config) {
    if (!config || typeof config !== 'object') return false;
    for (const field of REQUIRED_FIELDS) {
      if (!config.hasOwnProperty(field) || config[field] === '' || config[field] == null) {
        return false;
      }
    }
    return true;
  }

  /**
   * getDefaults — Return default config values shown in the setup form.
   *
   * @returns {object}
   */
  static getDefaults() {
    return {
      host: 'patchbox.local',
      port: 22,
      username: 'patch',
      password: 'raspberry',
    };
  }
}

module.exports = ConfigLoader;
