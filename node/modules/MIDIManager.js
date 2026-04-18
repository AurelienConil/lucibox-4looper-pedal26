const logger = require('./Logger');

class MIDIManager {
  constructor() {
    this.midiInput = null;
    this.midiOutput = null;
    this.messageCallback = null;
  }

  // Initialise les connexions MIDI
  initialize() {
    // TODO: Lister les ports MIDI disponibles
    // TODO: Se connecter aux ports d'entrée et sortie
    logger.info('MIDI Manager initialized');
  }

  // Liste les ports MIDI disponibles
  listPorts() {
    // TODO: Retourner la liste des ports MIDI
    logger.verbose('Listing MIDI ports...');
    return [];
  }

  // Se connecte à un port MIDI d'entrée
  connectInput(portName) {
    // TODO: Connexion au port d'entrée
    logger.info(`Connected to MIDI input: ${portName}`);
  }

  // Se connecte à un port MIDI de sortie
  connectOutput(portName) {
    // TODO: Connexion au port de sortie
    logger.info(`Connected to MIDI output: ${portName}`);
  }

  // Envoie un message MIDI
  sendMessage(message) {
    // TODO: Envoyer message MIDI
    logger.verbose(`MIDI -> ${message}`);
  }

  // Définit le callback pour les messages reçus
  onMessage(callback) {
    this.messageCallback = callback;
  }

  // Ferme les connexions MIDI
  disconnect() {
    // TODO: Fermer connexions MIDI
    logger.info('MIDI disconnected');
  }
}

module.exports = MIDIManager;
