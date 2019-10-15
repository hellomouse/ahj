/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import srp = require('srp-bigint');
import crypto = require('crypto');
import EventEmitter = require('events');
import net = require('net');
const debug = require('debug')('ahj:server');
const {
  StreamConsumer,
  aeadDecryptNext,
  aeadEncrypt
} = require('./protocol.js');
import constants = require('./constants');
import Session = require('./session');
import random = require('./random');
const SRP_PARAMS = srp.params[2048];

// const ConnectionModes = constants.ConnectionModes;
const ConnectionStates = constants.ConnectionStates;

/** @typedef {import('net').Socket} Socket */

/** Represents a server */
class Server extends EventEmitter {
  handshakeKey: Buffer;
  port: number;
  clients: any;
  sessionOptions: any;
  sessions: Map<number, ServerSession>;
  server: net.Server;
  connections: Set<ServerConnection>;
  /**
   * The constructor
   * @param {object} opts
   * @param {Buffer} opts.handshakeKey Handshake key
   * @param {number} opts.port Listen port
   * @param {object} opts.clients Client verifiers
   * @param {object} opts.sessionOptions Session options
   */
  constructor(opts: { handshakeKey: Buffer; port: number; clients: any; sessionOptions: any; }) {
    super();
    this.handshakeKey = opts.handshakeKey;
    this.port = opts.port;
    this.clients = opts.clients;
    this.sessionOptions = opts.sessionOptions;
    /** @type {Map<number, ServerSession>} */
    this.sessions = new Map();
    this.server = net.createServer(this.connectionHandler.bind(this));
    /** @type {Set<ServerConnection>} */
    this.connections = new Set();
  }
  /**
   * Connection handlers
   * @param {Socket} socket
   */
  connectionHandler(socket: net.Socket) {
    let connection = new ServerConnection(this, {
      socket,
      handshakeKey: this.handshakeKey,
      clients: this.clients,
      sessions: this.sessions,
      sessionOptions: this.sessionOptions
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
class ServerSession extends Session {
  connected: boolean;
  owner: string;
  sessions: Map<number, ServerSession>;

  /**
   * The constructor
   * @param {object} opts
   * @param {string} opts.owner User (by identity) this session belongs to
   * @param {Map<number, ServerSession>} opts.sessions Map of all sessions by id
   */
  constructor(opts: { owner: string; sessions: Map<number, ServerSession> }) {
    super(opts);
    this.connected = true;
    this.owner = opts.owner;
    this.sessions = opts.sessions;

    this.on('end', () => this.sessions.delete(this.sessionIdN));
  }
}

/** Represents one connection in a session */
class ServerConnection extends EventEmitter {
  server: Server;
  handshakeKey: any;
  socket: net.Socket;
  clients: any;
  sessionId: any;
  sessionIdN: any;
  sessions: Map<number, ServerSession>;
  sessionOptions: any;
  consumer: any;
  clientMessageCounter: number;
  serverMessageCounter: number;
  serverNonce: any;
  clientNonce: any;
  srpServer: any;
  sessionKey: any;
  state: symbol;
  socketError: any;
  remoteHost: string;
  ready: boolean;
  readStreamWrap: any;
  /**
   * The constructor
   * @param {Server} server The server this connection belongs to
   * @param {object} opts
   * @param {Socket} opts.socket The socket to handle
   * @param {Buffer} opts.handshakeKey Handshake key
   * @param {object} opts.clients List of client verifiers by identity
   * @param {Map<number, ServerSession>} opts.sessions Map of sessions by id
   * @param {object} opts.sessionOptions Session options
   */
  constructor(server: Server, opts: { socket: net.Socket; handshakeKey: Buffer; clients: {}; sessions: Map<number, ServerSession>; sessionOptions: any }) {
    super();
    this.server = server;
    this.handshakeKey = opts.handshakeKey;
    this.socket = opts.socket;
    this.clients = opts.clients;
    this.sessionId = null;
    this.sessionIdN = null; // numerical version of sessionId
    this.sessions = opts.sessions;
    this.sessionOptions = opts.sessionOptions;
    this.consumer = null;
    this.clientMessageCounter = 0;
    this.serverMessageCounter = 0;
    this.serverNonce = null;
    this.clientNonce = null;
    this.srpServer = null;
    /** @type {Buffer} */
    this.sessionKey = null;
    this.state = ConnectionStates.INIT;
    /** @type {Error} */
    this.socketError = null;
    this.remoteHost = `${this.socket.remoteAddress}:${this.socket.remotePort}`;
    // flow control: whether or not this connection should be written to
    this.ready = false;
    this.readStreamWrap = null;

    this.debugLog('new connection');
    this._handleConnection();
  }
  /**
   * Log a message with debug()
   * @param {string} message Message to log
   */
  debugLog(message: string) {
    if (!process.env.DEBUG) return;
    debug(`[${this.remoteHost}/${this.sessionIdN}] ${message}`);
  }
  /**
   * Set state of connection and emit event
   * @param {string} state One of DISCONNECTED, CONNECTING, HANDSHAKING, or CONNECTED
   */
  setState(state: string) {
    this.debugLog(`state ${this.state.description} => ${state.description}`);
    this.state = state;
    this.emit('stateChange', state);
  }
  /**
   * Send an encrypted message
   * @param {Buffer} buffer
   * @return {boolean} Whether or not data should continue to be written
   */
  sendMessage(buffer: Buffer): boolean {
    if (this.state !== ConnectionStates.CONNECTED) throw new Error('Not connected');
    if (buffer.length > 65535) throw new Error('Buffer is too long');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.serverNonce.copy(nonce);
    nonce.writeUIntBE(this.serverMessageCounter, 6, 6);
    this.serverMessageCounter++;
    // encrypted message
    let encrypted = aeadEncrypt(this.sessionKey, nonce, buffer);
    return this.ready = this.socket.write(encrypted);
  }
  /**
   * Destroy the socket with an error message
   * @param {string} message Error message
   * @param {string} code Error code (in error.code)
   * @return {Error}
   */
  destroyWithError(message: string, code: string): Error {
    this.debugLog('destroy ' + message);
    let error = new Error(message);
    if (code) error.code = code;
    this.socket.destroy(error);
    return error;
  }
  /**
   * Get the next message
   * @return {Buffer}
   */
  async readMessage(): Promise<Buffer | boolean> {
    if (this.state !== ConnectionStates.CONNECTED) throw new Error('Not connected');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.clientNonce.copy(nonce);
    nonce.writeUIntBE(this.clientMessageCounter, 6, 6);
    this.clientMessageCounter++;
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
  /** Internal method called after connection closed */
  _handleClose() {
    // remove connection from sessions
    let session = this.sessions.get(this.sessionIdN);
    if (!session) return;
    session.removeConnection(this);
  }
  /** Called internally to start processing the connection */
  async _handleConnection() {
    this.socket.on('drain', () => {
      this.ready = true;
      this.emit('drain');
    });
    this.socket.on('error', err => {
      this.debugLog('socket error ' + err);
      this.socketError = err;
      this.emit('socketError', err);
    });
    // if remote wants to end connection then we should stop sending data
    this.socket.on('end', () => this.ready = false);
    this.socket.on('close', errored => {
      this.setState(ConnectionStates.DISCONNECTED);
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
      this.destroyWithError('Client handshake message failed auth');
    }
    // client has correct handshake key
    this.debugLog('received client handshake message');
    this.setState(ConnectionStates.HANDSHAKING);
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
        Buffer.from([constants.ServerHandshake.INVALID_IDENTITY])
      ));
      this.socket.end();
      this.debugLog('client sent invalid identity');
      return;
    }
    let mode = clientMessage[offset++];
    if (mode === constants.ClientHandshake.INIT) {
      while (true) {
        this.sessionId = crypto.randomBytes(4);
        this.sessionIdN = this.sessionId.readUInt32BE();
        let session = this.sessions.get(this.sessionIdN);
        if (session) continue;
        // in the rare case that we have a collision...
        // (unless you have a few billion clients in which case HOW IS THIS
        // SERVER NOT DEAD YET)
        session = new ServerSession({
          ...this.sessionOptions,
          sessionId: this.sessionId,
          sessionIdN: this.sessionIdN,
          owner: identity,
          sessions: this.sessions
        });
        session.addConnection(this);
        this.sessions.set(this.sessionIdN, session);
        this.server.emit('newSession', session);
        this.debugLog('assigned session id ' + this.sessionIdN);
        break;
      }
    } else if (mode === constants.ClientHandshake.RESUME) {
      this.sessionId = Buffer.from(clientMessage.slice(offset, offset += 4));
      this.sessionIdN = this.sessionId.readUInt32BE();
      let session = this.sessions.get(this.sessionIdN);
      if (!session || (session.owner !== identity)) {
        this.socket.write(aeadEncrypt(
          this.handshakeKey, serverHandshakeNonce,
          Buffer.from([constants.ServerHandshake.INVALID_SESSION])
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
    let serverMessage = Buffer.alloc(random.int(261, 1400));
    offset = 0;
    serverMessage[offset++] = constants.ServerHandshake.OK;
    offset += this.sessionId.copy(serverMessage, offset);
    offset += srpB.copy(serverMessage, offset);
    this.socket.write(aeadEncrypt(
      this.handshakeKey, serverHandshakeNonce, serverMessage
    ));
    this.debugLog('sent server handshake message');
    // gc the srp instance
    this.srpServer = null;
    this.ready = true;
    this.setState(ConnectionStates.CONNECTED);
    this.emit('connected');
  }

  /** Close this connection */
  close() {
    this.socket.end();
  }
}

export = {
  Server,
  ServerSession,
  ServerConnection
};
