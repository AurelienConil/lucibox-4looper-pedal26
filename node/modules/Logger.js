class Logger {
  constructor() {
    this.isVerbose = false;
    this.levels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      VERBOSE: 3
    };
  }

  // Configure le mode verbose
  setVerbose(verbose) {
    this.isVerbose = verbose;
  }

  // Log d'erreur (toujours affiché)
  error(...args) {
    console.error(`[ERROR]`, ...args);
  }

  // Log d'avertissement (toujours affiché)
  warn(...args) {
    console.warn(`[WARN]`, ...args);
  }

  // Log d'information (toujours affiché)
  info(...args) {
    console.log(`[INFO]`, ...args);
  }

  // Log verbose (affiché seulement en mode verbose)
  verbose(...args) {
    if (this.isVerbose) {
      console.log(`[VERBOSE]`, ...args);
    }
  }

  // Log de débogage (alias pour verbose)
  debug(...args) {
    this.verbose(...args);
  }

  // Log simple (équivalent à l'ancien console.log, affiché en mode verbose)
  log(...args) {
    this.verbose(...args);
  }
}

// Créer une instance singleton
const logger = new Logger();

module.exports = logger;