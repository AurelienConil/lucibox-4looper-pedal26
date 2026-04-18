const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const logger = require('./Logger');

class ArduinoManager {
  constructor() {
    this.serialPort = null;
    this.isConnected = false;
    this.messageCallback = null;
    this._lastMessageAt = null;
    this._watchdog = null;
  }

  async findAndConnect() {
    logger.info('Scanning for LUCIBOX devices...');

    try {
      const ports = await SerialPort.list();
      logger.verbose(`Found ${ports.length} serial ports`);

      for (const port of ports.reverse()) {
        logger.verbose(`Testing ${port.path}...`);

        const serialPort = new SerialPort({
          path: port.path,
          baudRate: 38400
        });

        // testPort returns the already-open port on success, null on failure
        const validPort = await this.testPort(serialPort);

        if (validPort) {
          logger.info(`✓ LUCIBOX found on ${port.path}`);

          // Create the parser exactly once on the already-open port
          const parser = validPort.pipe(new ReadlineParser({ delimiter: '\n' }));

          parser.on('data', (data) => {
            this._lastMessageAt = Date.now();
            logger.verbose(`Message received: ${data.trim()}`);
            if (this.messageCallback) {
              this.messageCallback(data.trim());
            }
          });

          validPort.on('error', (err) => {
            logger.error('Serial port error:', err.message);
          });

          validPort.on('close', () => {
            logger.warn('Serial port closed — reconnecting in 5s...');
            this.isConnected = false;
            this._stopWatchdog();
            setTimeout(() => this.findAndConnect(), 5000);
          });

          this.serialPort = validPort;
          this.isConnected = true; // port is already open, 'open' event won't fire again
          logger.info(`Connected to Arduino on ${port.path}`);

          this._startWatchdog();

          setTimeout(() => {
            logger.verbose('Initializing system...');
            this.sendCommand("/lucibox/init 0 0");
          }, 2000);

          return;
        }
      }

      logger.warn('❌ No LUCIBOX device found');

    } catch (error) {
      logger.error('Error scanning ports:', error.message);
    }
  }

  async testPort(serialPort) {
    return new Promise((resolve) => {
      logger.info(`Testing port ${serialPort.path} for handshake...`);

      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

      const timeout = setTimeout(() => {
        parser.removeAllListeners('data');
        serialPort.unpipe(parser);
        if (serialPort.isOpen) serialPort.close();
        resolve(null);
      }, 5000);

      parser.on('data', (data) => {
        logger.verbose(`Received on ${serialPort.path}: ${data.toString().trim()}`);
        if (data.toString().trim().includes('LUCIBOX')) {
          clearTimeout(timeout);
          parser.removeAllListeners('data');
          serialPort.unpipe(parser); // detach test parser before returning
          serialPort.removeAllListeners('error'); // remove orphan error listener
          logger.info(`Handshake successful on ${serialPort.path}`);
          resolve(serialPort); // return the open port for reuse
        }
      });

      serialPort.on('error', (err) => {
        logger.error(`Error on ${serialPort.path}:`, err.message);
        clearTimeout(timeout);
        parser.removeAllListeners('data');
        if (serialPort.isOpen) serialPort.close();
        resolve(null);
      });
    });
  }

  _startWatchdog() {
    this._lastMessageAt = Date.now();
    this._watchdog = setInterval(() => {
      const silence = Date.now() - this._lastMessageAt;
      if (silence > 25000) {
        logger.warn(`Parser silent for ${silence}ms — restarting`);
        this._restartParser();
      }
    }, 15000);
  }

  _stopWatchdog() {
    if (this._watchdog) {
      clearInterval(this._watchdog);
      this._watchdog = null;
    }
  }

  _restartParser() {
    if (this.serialPort?.isOpen) {
      this._lastMessageAt = Date.now(); // space out restart attempts
      this.serialPort.unpipe();
      const parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (data) => {
        this._lastMessageAt = Date.now();
        logger.verbose(`Message received: ${data.trim()}`);
        if (this.messageCallback) this.messageCallback(data.trim());
      });
    }
  }

  sendCommand(message) {
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.write(`${message}\n`, (err) => {
        if (err) {
          logger.error('Error writing to serial port:', err.message);
        }
      });
    } else {
      logger.warn(`sendCommand ignored (not connected): ${message}`);
    }
  }

  onMessage(callback) {
    this.messageCallback = callback;
  }

  disconnect() {
    logger.info('Arduino disconnected');
    this._stopWatchdog();
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.close((err) => {
        if (err) {
          logger.error('Error closing serial port:', err.message);
        } else {
          logger.verbose('Serial port closed');
        }
      });
      this.isConnected = false;
    } else {
      logger.verbose('Serial port was not open');
    }
  }
}

module.exports = ArduinoManager;
