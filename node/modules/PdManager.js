// ========================================
// modules/audioManager.js
// ========================================

const logger = require('./Logger');

class PdManager {
  constructor() {
    this.audioProcess = null;
    this.isRunning = false;
  }

  // Lance le programme audio
  start(programPath, args = []) {
    // TODO: Lancer le processus audio avec child_process
    // TODO: Gérer stdout/stderr
    // TODO: Gérer les événements du processus
    logger.info(`Starting audio program: ${programPath}`);
    this.isRunning = true;
  }

  // Arrête le programme audio
  stop() {
    // TODO: Terminer le processus audio
    logger.info('Stopping audio program');
    this.isRunning = false;
  }

  // Redémarre le programme audio
  restart(programPath, args = []) {
    // TODO: Arrêter puis relancer le programme
    logger.info('Restarting audio program');
    this.stop();
    setTimeout(() => this.start(programPath, args), 1000);
  }

  // Vérifie si le programme tourne
  getStatus() {
    return {
      isRunning: this.isRunning,
      pid: this.audioProcess ? this.audioProcess.pid : null
    };
  }

  // Définit le callback pour les événements du processus
  onProcessEvent(callback) {
    this.processCallback = callback;
  }
}

module.exports = PdManager;