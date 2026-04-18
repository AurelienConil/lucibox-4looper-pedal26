const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./Logger');

class CLManager {
  constructor(options = {}) {
    this.allowedCommands = options.allowedCommands || [
      'git_pull',
      'git_commit',
      'poweroff',
      'reboot',
      'update_system',
      'check_status',
      'cpu_temp'
  ];
    
  this.projectRoot = options.projectRoot || process.cwd();
  this.messageCallback = null;
  this.isExecuting = false;
    
  logger.verbose('CLManager initialized with allowed commands:', this.allowedCommands);
  }

  // Callback pour recevoir les messages
  onMessage(callback) {
          this.messageCallback = callback;    
  }

  // Méthode pour notifier les autres modules
    sendMessage(type, data) {
        if (this.messageCallback) {
            this.messageCallback(type, data);
    }
  }

  // Exécute une commande système de manière sécurisée
  async executeCommand(commandName, params = {}) {
    if (this.isExecuting) {
      throw new Error('Une commande est déjà en cours d\'exécution');
    }

    if (!this.allowedCommands.includes(commandName)) {
      throw new Error(`Commande non autorisée: ${commandName}`);
    }

    this.isExecuting = true;
    
    try {
      logger.verbose(`Exécution de la commande: ${commandName}`);
      this.sendMessage('command_started', { command: commandName, params });
      
      const result = await this._executeSpecificCommand(commandName, params);
      
      this.sendMessage('command_completed', { 
        command: commandName, 
        success: true, 
        result 
      });
      
      return result;
      
    } catch (error) {
      logger.error(`Erreur lors de l'exécution de ${commandName}:`, error.message);
      
      this.sendMessage('command_error', { 
        command: commandName, 
        error: error.message 
      });
      
      throw error;
      
    } finally {
      this.isExecuting = false;
    }
  }

  // Exécute la commande spécifique
  async _executeSpecificCommand(commandName, params) {
    switch (commandName) {
      case 'git_pull':
        return await this._gitPull();
        
      case 'git_commit':
        return await this._gitCommit();
        
      case 'poweroff':
        return await this._poweroff();
        
      case 'reboot':
        return await this._reboot();
        
      case 'update_system':
        return await this._updateSystem();
        
      case 'check_status':
        return await this._checkStatus();
        
      case 'cpu_temp':
        return await this._cpuTemp();
        
      default:
        throw new Error(`Commande inconnue: ${commandName}`);
    }
  }

  // Git pull
  async _gitPull() {
    return new Promise((resolve, reject) => {
      const commands = [
        'sudo mount -o remount,rw / && sudo mount -o remount,rw /boot', // Passer en mode lecture-écriture
        'git pull',
        'sudo mount -o remount,ro / && sudo mount -o remount,ro /boot'  // Revenir en mode readonly
      ];

      const gitProcess = exec(commands.join(' && '), {
        cwd: this.projectRoot,
        timeout: 30000 // 30 secondes max
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git pull failed: ${error.message}`));
          return;
        }

        const output = stdout + stderr;
        logger.verbose('Git pull output:', output);

        resolve({
          success: true,
          output: output.trim(),
          message: 'Mise à jour Git réussie'
        });
      });
    });
  }

  // Récupération du commit actuel
  async _gitCommit() {
    return new Promise((resolve, reject) => {
      const gitProcess = exec('git log -1 --pretty=format:"%h - %s (%an, %ar)"', { 
        cwd: this.projectRoot,
        timeout: 10000 // 10 secondes max
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git commit info failed: ${error.message}`));
          return;
        }
        
        const commitInfo = stdout.trim();
        logger.verbose('Git commit info:', commitInfo);
        
        resolve({
          success: true,
          commit: commitInfo,
          message: 'Informations du commit récupérées'
        });
      });
    });
  }



  // Arrêt du système (Raspberry Pi)
  async _poweroff() {
    return new Promise((resolve, reject) => {
      // Vérification si on est sur un système Unix/Linux
      if (process.platform !== 'linux') {
        reject(new Error('Poweroff disponible uniquement sur Linux'));
        return;
      }
      
      logger.info('Arrêt du système programmé dans 5 secondes...');
      
      setTimeout(() => {
        exec('sudo poweroff', (error) => {
          if (error) {
            reject(new Error(`Poweroff failed: ${error.message}`));
          }
        });
      }, 5000);
      
      resolve({
        success: true,
        message: 'Arrêt du système programmé dans 5 secondes'
      });
    });
  }

  // Redémarrage du système (Raspberry Pi)
  async _reboot() {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'linux') {
        reject(new Error('Reboot disponible uniquement sur Linux'));
        return;
      }
      
      logger.info('Redémarrage du système programmé dans 5 secondes...');
      
      setTimeout(() => {
        exec('sudo reboot', (error) => {
          if (error) {
            reject(new Error(`Reboot failed: ${error.message}`));
          }
        });
      }, 5000);
      
      resolve({
        success: true,
        message: 'Redémarrage du système programmé dans 5 secondes'
      });
    });
  }

  // Mise à jour du système
  async _updateSystem() {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'linux') {
        reject(new Error('Update disponible uniquement sur Linux'));
        return;
      }
      
      logger.info('Mise à jour du système...');
      
      const updateProcess = exec('sudo apt update && sudo apt upgrade -y', {
        timeout: 300000 // 5 minutes max
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`System update failed: ${error.message}`));
          return;
        }
        
        resolve({
          success: true,
          output: stdout + stderr,
          message: 'Mise à jour système terminée'
        });
      });
    });
  }

  // Vérification du statut
  async _checkStatus() {
    return new Promise((resolve) => {
      const status = {
        platform: process.platform,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        projectRoot: this.projectRoot,
        timestamp: new Date().toISOString()
      };

      // Ajouter des infos système si on est sur Linux
      if (process.platform === 'linux') {
        exec('uptime && df -h / && free -h', (error, stdout) => {
          if (!error) {
            status.systemInfo = stdout;
          }

          this.sendMessage('command_completed', {
            command: 'check_status',
            success: true,
            result: status,
            message: 'Statut système récupéré'
          });

          resolve({
            success: true,
            status,
            message: 'Statut système récupéré'
          });
        });
      } else {
        this.sendMessage('command_completed', {
          command: 'check_status',
          success: true,
          result: status,
          message: 'Statut système récupéré'
        });

        resolve({
          success: true,
          status,
          message: 'Statut système récupéré'
        });
      }
    });
  }

  // Récupération de la température CPU
  async _cpuTemp() {
    return new Promise((resolve, reject) => {
      exec("top -bn1 | grep 'Cpu(s)' && vcgencmd measure_temp", (error, stdout) => {
        if (error) {
          reject(new Error('Erreur lors de la récupération des données CPU/température'));
          return;
        }

        const lines = stdout.split('\n');
        logger.verbose('Sortie de la commande CPU/température:', lines);

        try {
          // Extraire les valeurs pour `us` et `sy`
          const cpuLine = lines[0];
          const cpuUsageMatch = cpuLine.match(/([\d.]+)\s+us,\s+([\d.]+)\s+sy/);
          if (!cpuUsageMatch) {
            throw new Error('Impossible d\'extraire l\'utilisation CPU');
          }
          const userTime = parseFloat(cpuUsageMatch[1]);
          const systemTime = parseFloat(cpuUsageMatch[2]);
          const totalCpuUsage = userTime + systemTime;

          // Extraire la température
          const temperatureLine = lines[1];
          const temperatureMatch = temperatureLine.match(/temp=([\d.]+)'C/);
          if (!temperatureMatch) {
            throw new Error('Impossible d\'extraire la température');
          }
          const temperature = parseFloat(temperatureMatch[1]);

          resolve({
            cpuUsage: totalCpuUsage.toFixed(1), // Utilisation totale du CPU
            temperature: temperature.toFixed(1)
          });
        } catch (parseError) {
          reject(new Error(`Erreur lors de l'analyse des données: ${parseError.message}`));
        }
      });
    });
  }

  // Méthode pour ajouter des commandes personnalisées
  addCustomCommand(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Le handler doit être une fonction');
    }
    
    this.allowedCommands.push(name);
    this[`_${name}`] = handler;
    
    logger.verbose(`Commande personnalisée ajoutée: ${name}`);
  }

  // Obtenir la liste des commandes disponibles
  getAvailableCommands() {
    return this.allowedCommands.map(cmd => ({
      name: cmd,
      description: this._getCommandDescription(cmd)
    }));
  }

  // Descriptions des commandes
  _getCommandDescription(command) {
    const descriptions = {
      'git_pull': 'Met à jour le code depuis Git',
      'git_commit': 'Récupère les infos du commit actuel',
      'poweroff': 'Éteint le Raspberry Pi',
      'reboot': 'Redémarre le Raspberry Pi',
      'update_system': 'Met à jour le système (apt)',
      'check_status': 'Vérifie le statut du système',
      'cpu_temp': 'Vérifie la température du CPU'
    };
    
    return descriptions[command] || 'Commande personnalisée';
  }

  // Arrêt du module
  stop() {
    logger.info('CLManager stopped');
  }
}

module.exports = CLManager;