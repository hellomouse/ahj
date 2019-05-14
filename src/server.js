const srp = require('srp-bigint');
const crypto = require('crypto');
const EventEmitter = require('events');
const net = require('net');
const debug = require('debug')('ahj:server');
const {
  StreamConsumer,
  aeadDecryptNext,
  aeadEncrypt
} = require('./protocol.js');
const constants = require('./constants.js');
const SRP_PARAMS = srp.params[2048];

/** Represents a server */
class Server extends EventEmitter {
  /**
   * The constructor
   * @param {Object} opts
   * @param {Buffer} opts.handshakeKey Handshake key
   * @param {Number} opts.port Listen port
   * @param {Object} opts.clients Client verifiers
   */
  constructor(opts) {
    super();
    this.handshakeKey = opts.handshakeKey;
    this.port = opts.port;
    this.clients = opts.clients;
    /** @type {Map<Number, Session>} */
    this.sessions = new Map();
    this.server = net.createServer(this.connectionHandler.bind(this));
    /** @type {Set<ServerConnection>} */
    this.connections = new Set();
  }
  /**
   * Connection handlers
   * @param {Socket} socket
   */
  connectionHandler(socket) {
    let connection = new ServerConnection({
      socket,
      handshakeKey: this.handshakeKey,
      clients: this.clients,
      sessions: this.sessions
    });
    this.connections.add(connection);
    connection.on('close', () => this.connections.delete(connection));
    this.emit('newConnection', connection);
  }
  /** Start listening */
  listen() {
    this.server.listen(this.port);
  }
}

/** Represents one session */
class Session extends EventEmitter {
  /**
   * The constructor
   * @param {Object} opts
   * @param {Number} opts.sessionId Numerical session id of this session
   * @param {String} opts.owner User (by identity) this session belongs to
   * @param {Map<Number, Session>} opts.sessions Map of all sessions by id
   */
  constructor(opts) {
    super();
    this.owner = opts.owner;
    this.sessionId = opts.sessionId;
    this.sessions = opts.sessions;
    this.connections = [];
  }
  /**
   * Add a connection to this session
   * @param {ServerConnection} conn
   */
  addConnection(conn) {
    if (this.connections.includes(conn)) throw new Error('Already exists!');
    this.connections.push(conn);
  }
  /**
   * Remove a connection from this session
   * @param {ServerConnection} conn
   */
  removeConnection(conn) {
    let index = this.connections.indexOf(conn);
    if (index < 0) throw new Error('No such connection');
    this.connections.splice(index, 1);
    if (this.connections.length === 0) this.sessions.delete(this.sessionId);
  }
}

/** Represents one connection in a session */
class ServerConnection extends EventEmitter {
  /**
   * The constructor
   * @param {Object} opts
   * @param {Socket} opts.socket The socket to handle
   * @param {Buffer} opts.handshakeKey Handshake key
   * @param {Object} opts.clients List of client verifiers by identity
   * @param {Map<Number, Session>} opts.sessions Map of sessions by id
   */
  constructor(opts) {
    super();
    this.handshakeKey = opts.handshakeKey;
    this.socket = opts.socket;
    this.clients = opts.clients;
    this.sessionId = null;
    this.sessionIdN = null; // numerical version of sessionId
    this.sessions = opts.sessions;
    this.consumer = null;
    this.clientMessageCounter = 0;
    this.serverMessageCounter = 0;
    this.serverNonce = null;
    this.clientNonce = null;
    this.srpServer = null;
    /** @type {Buffer} */
    this.sessionKey = null;
    this.state = 'INIT';
    /** @type {Error} */
    this.socketError = null;
    this.remoteHost = `${this.socket.remoteAddress}:${this.socket.remotePort}`;

    this.debugLog('new connection');
    this._handleConnection();
  }
  /**
   * Log a message with debug()
   * @param {String} message Message to log
   */
  debugLog(message) {
    debug(`[${this.remoteHost}/${this.sessionIdN}] ${message}`);
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
    this.serverNonce.copy(nonce);
    nonce.writeUIntBE(this.serverMessageCounter, 6, 6);
    this.serverMessageCounter++;
    // encrypted message
    let encrypted = aeadEncrypt(this.sessionKey, nonce, buffer);
    this.socket.write(encrypted);
  }
  /**
   * Destroy the socket with an error message
   * @param {String} message Error message
   * @return {Error}
   */
  destroyWithError(message) {
    this.debugLog('destroy ' + message);
    let error = new Error(message);
    this.socket.destroy(error);
    return error;
  }
  /**
   * Get the next message
   * @return {Buffer}
   */
  async readMessage() {
    if (this.state !== 'CONNECTED') throw new Error('Not connected');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.clientNonce.copy(nonce);
    nonce.writeUIntBE(this.clientMessageCounter, 6, 6);
    this.clientMessageCounter++;
    // decrypt message
    try {
      return await aeadDecryptNext(this.sessionKey, nonce, this.consumer);
    } catch (err) {
      // failed verification, kill the connection
      throw this.destroyWithError('Client message failed authentication');
    }
  }
  /** Internal method called after connection closed */
  _handleClose() {
    // remove connection from sessions
    let session = this.sessions.get(this.sessionIdN);
    if (!session) return; // wat
    session.removeConnection(this);
  }
  /** Called internally to start processing the connection */
  async _handleConnection() {
    this.socket.on('error', err => {
      this.debugLog('socket error ' + err);
      this.socketError = err;
      this.emit('socketError', err);
    });
    this.socket.on('close', errored => {
      this.setState('DISCONNECTED');
      this.debugLog('close');
      this._handleClose();
      this.emit('close', errored ? this.socketError : null);
    });
    this.consumer = new StreamConsumer(this.socket);
    let nonce = await this.consumer.read(12);
    this.clientNonce = nonce.slice(0, 6);
    this.debugLog('received client nonce');
    let clientMessage;
    try {
      clientMessage = await aeadDecryptNext(
        this.handshakeKey, nonce, this.consumer
      );
    } catch (err) {
      throw this.destroyWithError('Client handshake message failed auth');
    }
    // client has correct handshake key
    this.debugLog('received client handshake message');
    this.setState('HANDSHAKING');
    let offset = 0;
    let identityLength = clientMessage[offset++];
    let identity = clientMessage.slice(offset, offset += identityLength);
    identity = identity.toString();
    this.debugLog('received identity ' + identity);
    let verifier = this.clients[identity];
    let serverHandshakeNonce = crypto.randomBytes(12);
    this.serverNonce = serverHandshakeNonce.slice(0, 6);
    this.socket.write(serverHandshakeNonce);
    if (!verifier) {
      this.socket.write(aeadEncrypt(
        this.handshakeKey, serverHandshakeNonce,
        Buffer.from([constants.serverHandshake.INVALID_IDENTITY])
      ));
      this.socket.end();
      this.debugLog('client sent invalid identity');
      return;
    }
    let mode = clientMessage[offset++];
    if (mode === constants.clientHandshake.INIT) {
      for (;;) {
        this.sessionId = crypto.randomBytes(4);
        this.sessionIdN = this.sessionId.readUInt32BE();
        let session = this.sessions.get(this.sessionIdN);
        if (session) continue;
        // in the extraordinarly rare case that we have a collision...
        // (unless you have a few billion clients in which case HOW IS THIS
        // SERVER NOT DEAD YET)
        session = new Session({
          sessionId: this.sessionIdN,
          owner: identity,
          sessions: this.sessions
        });
        session.addConnection(this);
        this.sessions.set(this.sessionIdN, session);
        this.debugLog('assigned session id ' + this.sessionIdN);
        break;
      }
    } else if (mode === constants.clientHandshake.RESUME) {
      this.sessionId = Buffer.from(clientMessage.slice(offset, offset += 4));
      this.sessionIdN = this.sessionId.readUInt32BE();
      let session = this.sessions.get(this.sessionIdN);
      if (!session) {
        this.socket.write(aeadEncrypt(
          this.handshakeKey, serverHandshakeNonce,
          Buffer.from([constants.serverHandshake.INVALID_SESSION])
        ));
        this.socket.end();
        this.debugLog('client requested invalid session');
        return;
      }
      session.addConnection(this);
      this.debugLog('joining session ' + this.sessionIdN);
    }
    let srpA = clientMessage.slice(offset, offset += 256);
    let srpServerSecret = crypto.randomBytes(32);
    this.srpServer = new srp.Server(SRP_PARAMS, verifier, srpServerSecret);
    this.srpServer.setA(srpA);
    let srpB = this.srpServer.computeB();
    this.sessionKey = this.srpServer.computeK();
    // OK (1 byte) + session identifier (4 bytes) + srp B (256 bytes)
    // TODO: more padding
    let serverMessage = Buffer.alloc(261);
    offset = 0;
    serverMessage[offset++] = constants.serverHandshake.OK;
    offset += this.sessionId.copy(serverMessage, offset);
    offset += srpB.copy(serverMessage, offset);
    this.socket.write(aeadEncrypt(
      this.handshakeKey, serverHandshakeNonce, serverMessage
    ));
    this.debugLog('sent server handshake message');
    // gc the srp instance
    this.srpServer = null;
    this.setState('CONNECTED');
    this.emit('connected');
  }
}

module.exports = Server;
Server.Session = Session;
Server.ServerConnection = ServerConnection;
