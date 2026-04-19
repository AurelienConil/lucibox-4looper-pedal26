'use strict';

/**
 * index.js — Application entry point
 *
 * Responsibilities:
 *  1. Load (or create) monitor_config.json via ConfigLoader
 *  2. If config is missing/incomplete, show the Config screen first
 *  3. Init the blessed screen object (shared across all UI modules)
 *  4. Establish the SSH connection via SSHManager
 *  5. Mount the Runtime screen as the default view
 *  6. Handle global key bindings: [q] quit, [c] toggle Config screen
 *  7. Enforce minimum terminal size (120×40) and display a warning if needed
 */

const blessed = require('blessed');
const ConfigLoader = require('./modules/ConfigLoader');
const SSHManager = require('./modules/SSHManager');
const RuntimeScreen = require('./screens/RuntimeScreen');
const ConfigCheckScreen = require('./screens/ConfigCheckScreen');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  let config = await ConfigLoader.load();
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Lucibox Monitor',
  });
  screen.program.setTitle('Lucibox Monitor');
  checkTerminalSize(screen);

  let ssh = null;
  let runtimeScreen = null;
  let configScreen = null;

  function showRuntime() {
    configScreen && configScreen.hide();
    runtimeScreen && runtimeScreen.show();
    screen.render();
  }
  function showConfig() {
    runtimeScreen && runtimeScreen.hide();
    configScreen && configScreen.show();
    screen.render();
  }

  // If config is missing, show config screen only
  if (!config) {
    ssh = new SSHManager(ConfigLoader.getDefaults());
    configScreen = new ConfigCheckScreen(screen, ssh, async () => {
      config = await ConfigLoader.load();
      if (config) {
        ssh = new SSHManager(config);
        runtimeScreen = new RuntimeScreen(screen, ssh, config);
        showRuntime();
        ssh.connect();
      } else {
        showConfig();
      }
    });
    showConfig();
  } else {
    ssh = new SSHManager(config);
    runtimeScreen = new RuntimeScreen(screen, ssh, config);
    configScreen = new ConfigCheckScreen(screen, ssh, showRuntime);
    showRuntime();
    ssh.connect();
  }

  // ---------------------------------------------------------------------------
  // Global key bindings
  // ---------------------------------------------------------------------------

  // [q] — Graceful quit: close SSH streams, destroy blessed screen, exit process
  screen.key(['q', 'C-c'], () => {
    if (ssh) ssh.disconnect();
    screen.destroy();
    process.exit(0);
  });

  // [c] — Toggle between Runtime and Config screen
  screen.key('c', () => {
    if (runtimeScreen && runtimeScreen._container.visible) {
      showConfig();
    } else {
      showRuntime();
    }
  });

  // [Escape] — Return to Runtime from Config
  screen.key('escape', () => {
    if (configScreen && configScreen._container.visible) {
      showRuntime();
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * checkTerminalSize — Warns the user if the terminal is smaller than the
 * recommended minimum (120 columns × 40 rows).
 *
 * @param {blessed.screen} screen
 */
function checkTerminalSize(screen) {
  function warn() {
    if (screen.width < 120 || screen.height < 40) {
      if (!screen._sizeWarn) {
        const blessed = require('blessed');
        screen._sizeWarn = blessed.box({
          parent: screen,
          top: 'center', left: 'center', width: 60, height: 5,
          content: 'Terminal trop petit !\n120 colonnes × 40 lignes minimum',
          style: { fg: 'white', bg: 'red', border: { fg: 'yellow' } },
          border: 'line',
        });
      }
      screen._sizeWarn.show();
    } else if (screen._sizeWarn) {
      screen._sizeWarn.hide();
    }
    screen.render();
  }
  warn();
  screen.on('resize', warn);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
