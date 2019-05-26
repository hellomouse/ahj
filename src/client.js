const srp = require('srp-bigint');
const crypto = require('crypto');
const EventEmitter = require('events');
const debug = require('debug')('ahj:client');
const net = require('net');
const {
  StreamConsumer,
  aeadDecryptNext,
  aeadEncrypt
} = require('./protocol.js');
const constants = require('./constants.js');
const utils = require('./utils.js');
const SRP_PARAMS = srp.params[2048];

/** Represents a client */
class Client extends EventEmitter {
  /**
   * The constructor
   * @param {Object} opts
   * @param {String} opts.host Server hostname
   * @param {Number} opts.port Server port
   * @param {Buffer} opts.handshakeKey Server handshake key
   * @param {Buffer} opts.salt SRP authentication salt
   * @param {Buffer} opts.identity SRP identity
   * @param {Buffer} opts.password SRP password
   */
  constructor(opts) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.handshakeKey = opts.handshakeKey;
    this.salt = opts.salt;
    this.identity = opts.identity;
    this.password = opts.password;

    this.connections = [];
    this.sessionId = null;
    this.connected = false;
  }
  /**
   * Adds connection to this.connections and adds event listeners
   * @param {ClientConnection} connection
   */
  _handleConnect(connection) {
    this.connections.push(connection);
    connection.on('close', () => {
      this.connections.splice(this.connections.indexOf(connection), 1);
      if (!this.connections.length) {
        this.connected = false;
        this.sessionId = null;
      }
    });
  }
  /** Do initial connection to server */
  async connect() {
    let connection = new ClientConnection({
      host: this.host,
      port: this.port,
      mode: 'INIT',
      handshakeKey: this.handshakeKey,
      salt: this.salt,
      identity: this.identity,
      password: this.password
    });
    await connection.connect();
    // connected to server
    this.connected = true;
    this.sessionId = connection.sessionId;
    this._handleConnect(connection);
  }
  /** Add a connection to the session */
  async addConnection() {
    if (!this.connected) throw utils.errCode('Not connected', 'NOT_CONNECTED');
    let connection = new ClientConnection({
      host: this.host,
      port: this.port,
      mode: 'RESUME',
      sessionId: this.sessionId,
      handshakeKey: this.handshakeKey,
      salt: this.salt,
      identity: this.identity,
      password: this.password
    });
    await connection.connect();
    this._handleConnect(connection);
  }
  /** End all connections */
  async close() {
    for (let connection of this.connections) connection.socket.end();
  }
}

/** Represents one connection in the session */
class ClientConnection extends EventEmitter {
  /**
   * The constructor
   * @param {Object} opts
   * @param {String} opts.host Server hostname
   * @param {Number} opts.port Server port
   * @param {String} opts.mode Connection mode, either INIT or RESUME
   * @param {Buffer} [opts.sessionId] Session id, specify with mode RESUME
   * @param {Buffer} opts.handshakeKey Server handshake key
   * @param {Buffer} opts.salt SRP authentication salt
   * @param {Buffer} opts.identity SRP identity
   * @param {Buffer} opts.password SRP password
   */
  constructor(opts) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.handshakeKey = opts.handshakeKey;
    this.salt = opts.salt;
    this.identity = opts.identity;
    this.password = opts.password;
    this.mode = opts.mode;
    this.sessionId = opts.sessionId || null;
    this.sessionIdN = this.sessionId && this.sessionId.readUInt32BE();

    this.socket = null;
    this.consumer = null;
    this.clientMessageCounter = 0;
    this.serverMessageCounter = 0;
    this.serverNonce = null;
    this.clientNonce = null;
    this.srpClient = null;
    this.sessionKey = null;
    this.state = 'DISCONNECTED';
    this.socketError = null;
    // for debugging and connection identification
    this.localPort = null;

    this.debugLog(`init: mode ${this.mode} to ${this.host}:${this.port}`);
  }
  /**
   * Log a debug message
   * @param {String} message
   */
  debugLog(message) {
    debug(`[${this.localPort}/${this.sessionIdN}] ${message}`);
  }
  /**
   * Set state of connection and emit event
   * @param {String} state One of DISCONNECTED, CONNECTING, HANDSHAKING, or CONNECTED
   */
  setState(state) {
    this.debugLog(`state ${this.state} => ${state}`);
    this.state = state;
    this.emit('stateChange', state);
  }
  /**
   * Send an encrypted message
   * @param {Buffer} buffer
   */
  sendMessage(buffer) {
    if (this.state !== 'CONNECTED') throw new Error('Not connected');
    if (buffer.length > 65535) throw new Error('Buffer is too long');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.clientNonce.copy(nonce);
    nonce.writeUIntBE(this.clientMessageCounter, 6, 6);
    this.clientMessageCounter++;
    // encrypted message
    let encrypted = aeadEncrypt(this.sessionKey, nonce, buffer);
    this.socket.write(encrypted);
  }
  /**
   * Get the next message
   * @return {Buffer}
   */
  async readMessage() {
    if (this.state !== 'CONNECTED') throw new Error('Not connected');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.serverNonce.copy(nonce);
    nonce.writeUIntBE(this.serverMessageCounter, 6, 6);
    this.serverMessageCounter++;
    // decrypt message
    try {
      return await aeadDecryptNext(this.sessionKey, nonce, this.consumer);
    } catch (err) {
      switch (err.code) {
        case 'STREAM_CLOSED': return false; // connection ended, do nothing
        case 'AUTHENTICATION_FAILED':
          // failed authentication, terminate connection
          throw this.destroyWithError('Server message failed authentication',
            'AUTHENTICATION_FAILED');
        default: throw err;
      }
    }
  }
  /** Called internally on socket close */
  _handleClose() {
    this.setState('DISCONNECTED');
    this.clientNonce = null;
    this.serverNonce = null;
    this.socket = null;
    this.consumer = null;
    this.clientMessageCounter = 0;
    this.serverMessageCounter = 0;
    this.sessionKey = null;
    this.srpClient = null;
  }
  /**
   * Destroy the socket with an error message
   * @param {String} message Error message
   * @param {String} code Error code (in error.code)
   * @return {Error}
   */
  destroyWithError(message, code) {
    this.debugLog('destroy ' + message);
    let error = new Error(message);
    if (code) error.code = code;
    this.socket.destroy(error);
    return error;
  }
  /** Connect to the server */
  async connect() {
    if (this.state !== 'DISCONNECTED') throw new Error('Not disconnected');
    this.setState('CONNECTING');
    this.socket = new net.Socket();
    this.socketError = null;
    let clientHandshakeNonce = crypto.randomBytes(12);
    this.clientNonce = clientHandshakeNonce.slice(0, 6);
    // the 'close' event comes after the 'error' event
    this.socket.on('error', err => {
      this.socketError = err;
      this.debugLog('error ' + err);
      this.emit('socketError', err);
    });
    this.socket.on('close', errored => {
      this._handleClose();
      this.debugLog('close');
      this.emit('close', errored ? this.socketError : null);
    });
    // what follows is a humongous mess which attempts to throw an error
    // into this function if the connection dies during handshake
    await (() => new Promise((resolve, reject) => {
      let cleanUpEventHandlers = () => {
        this.socket.removeListener('connect', connectHandler);
        this.socket.removeListener('close', closeHandler);
      };
      let connectHandler = () => {
        this.localPort = this.socket.localPort;
        cleanUpEventHandlers();
        resolve();
      };
      let closeHandler = () => {
        cleanUpEventHandlers();
        reject(this.socketError);
      };
      this.socket.on('connect', connectHandler);
      this.socket.on('close', closeHandler);
      this.debugLog('socket connecting');
      this.socket.connect(this.port, this.host);
    }))();
    this.debugLog('socket connected');
    this.consumer = new StreamConsumer(this.socket);
    // do handshake
    this.setState('HANDSHAKING');
    // init local SRP state
    let srpClientSecret = crypto.randomBytes(32);
    this.srpClient = new srp.Client(
      SRP_PARAMS, this.salt, this.identity, this.password, srpClientSecret
    );
    let srpA = this.srpClient.computeA();
    /* Handshake length
       Identity length: 1 byte
       Identity: 1-255 bytes
       Mode: 1 byte
       Session identifier (optional): 4 bytes
       SRP A: 256 bytes

       Total: 258 + identity length + 4 if Mode is RESUME */
    // TODO: pad client handshake message
    let clientMessage = Buffer.allocUnsafe(258 + this.identity.length +
      (this.mode === 'RESUME' ? 4 : 0));
    let offset = 0;
    clientMessage[offset++] = this.identity.length; // identity length
    offset += this.identity.copy(clientMessage, offset);
    clientMessage[offset++] = constants.clientHandshake[this.mode]; // mode
    if (this.mode === 'RESUME') {
      offset += this.sessionId.copy(clientMessage, offset);
    }
    offset += srpA.copy(clientMessage, offset);
    this.socket.write(clientHandshakeNonce);
    this.socket.write(aeadEncrypt(
      this.handshakeKey, clientHandshakeNonce, clientMessage
    ));
    this.debugLog('sent client handshake message');
    let serverHandshakeNonce = await this.consumer.read(12);
    this.debugLog('received server nonce');
    this.serverNonce = serverHandshakeNonce.slice(0, 6);
    let serverMessage;
    try {
      serverMessage = await aeadDecryptNext(
        this.handshakeKey, serverHandshakeNonce, this.consumer
      );
    } catch (err) {
      throw this.destroyWithError('Server handshake message failed authentication');
    }
    this.debugLog('received server handshake message');
    switch (serverMessage[0]) {
      case constants.serverHandshake.OK:
        // everything is good
        break;
      case constants.serverHandshake.INVALID_SESSION:
        throw this.destroyWithError('Session identifier is invalid');
      case constants.serverHandshake.INVALID_IDENTITY:
        throw this.destroyWithError('Invalid identity');
      default:
        throw this.destroyWithError('Invalid server response');
    }
    this.debugLog('no error from server');
    this.sessionId = Buffer.from(serverMessage.slice(1, 5));
    this.sessionIdN = this.sessionId.readUInt32BE();
    this.srpClient.setB(serverMessage.slice(5));
    this.sessionKey = this.srpClient.computeK();
    // GC the SRP instance
    this.srpClient = null;
    this.setState('CONNECTED');
    this.emit('connected');
  }
}

module.exports = {
  Client,
  ClientConnection
};
