const osc = require('node-osc');
const logger = require('./Logger');

class OSCManager {
  constructor() {
    this.oscClient = null;
    this.oscServer = null;
    this.messageHandlers = [];
    this.isListening = false;
  }

  // Initialise le client et serveur OSC
  initialize(clientHost = '127.0.0.1', clientPort = 8000, serverPort = 8001) {
    try {
      // Initialiser le client OSC pour envoyer des messages
      this.oscClient = new osc.Client(clientHost, clientPort);
      
      // Initialiser le serveur OSC pour recevoir des messages
      this.oscServer = new osc.Server(serverPort);
      
      logger.info(`OSC Client initialized: ${clientHost}:${clientPort}`);
      logger.info(`OSC Server initialized on port: ${serverPort}`);
      
      return true;
    } catch (error) {
      logger.error('Error initializing OSC:', error.message);
      return false;
    }
  }

  // Envoie un message OSC
  sendMessage(address, ...values) {
    if (!this.oscClient) {
      logger.error('OSC Client not initialized');
      return false;
    }

    try {
      if (values.length === 0) {
        this.oscClient.send(address);
      } else if (values.length === 1) {
        this.oscClient.send(address, values[0]);
      } else {
        this.oscClient.send(address, ...values);
      }
      
      logger.verbose(`OSC -> ${address} ${values.join(' ')}`);
      return true;
    } catch (error) {
      logger.error('Error sending OSC message:', error.message);
      return false;
    }
  }

  // Ajoute un handler pour les messages entrants
  addMessageHandler(handler) {
    if (typeof handler === 'function') {
      this.messageHandlers.push(handler);
    } else {
      logger.error('Message handler must be a function');
    }
  }

  // Démarre l'écoute des messages OSC
  startListening() {
    if (!this.oscServer) {
      logger.error('OSC Server not initialized');
      return false;
    }

    if (this.isListening) {
      logger.verbose('OSC Server already listening');
      return true;
    }

    try {
      this.oscServer.on('message', (msg) => {
        // msg format: [ '/lucibox/led/set', 4, 2 ] - address + values
        if (Array.isArray(msg) && msg.length > 0) {
          const address = msg[0];
          const values = msg.slice(1);
          
          logger.verbose(`OSC <- ${address} ${values.join(' ')}`);
          
          // Appeler tous les handlers enregistrés
          this.messageHandlers.forEach(handler => {
            try {
              handler(address, ...values);
            } catch (error) {
              logger.error('Error in OSC message handler:', error.message);
            }
          });
        }
      });

      this.oscServer.on('error', (error) => {
        logger.error('OSC Server error:', error.message);
      });

      this.isListening = true;
      logger.info('OSC Server listening for messages...');
      return true;
      
    } catch (error) {
      logger.error('Error starting OSC server:', error.message);
      return false;
    }
  }

  // Arrête l'écoute des messages OSC
  stopListening() {
    if (this.oscServer && this.isListening) {
      // Note: node-osc ne semble pas avoir de méthode close() standard
      // On peut au moins marquer comme non-listening
      this.isListening = false;
      logger.verbose('OSC Server stopped listening');
    }
  }

  // Arrête les connexions OSC
  stop() {
    this.stopListening();
    
    // Nettoyer les références
    this.oscClient = null;
    this.oscServer = null;
    this.messageHandlers = [];
    
    logger.info('OSC Manager stopped');
  }

  // Retourne le statut de l'OSC Manager
  getStatus() {
    return {
      clientInitialized: !!this.oscClient,
      serverInitialized: !!this.oscServer,
      isListening: this.isListening,
      handlersCount: this.messageHandlers.length
    };
  }
}

module.exports = OSCManager;