/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as srp from 'srp-bigint';
import crypto from 'crypto';
import EventEmitter from 'events';
import dbg from 'debug';
const debug = dbg('ahj:client');
import net from 'net';
import {
  StreamConsumer,
  aeadDecryptNext,
  aeadEncrypt
} from './protocol';
import constants from './constants';
import { errCode } from './utils';
import Session, { SessionOptions } from './session';
import { int } from './random';
import { CustomError } from './server';
const SRP_PARAMS = srp.params[2048];
const ConnectionModes = constants.ConnectionModes;
const ConnectionStates = constants.ConnectionStates;

/** Represents a client */
class Client extends EventEmitter {
  host: string;
  port: number;
  handshakeKey: Buffer;
  salt: Buffer;
  identity: Buffer;
  password: Buffer;
  session: Session;
  sessionOptions?: SessionOptions;
  /**
   * The constructor
   * @param {object} opts
   * @param {string} opts.host Server hostname
   * @param {number} opts.port Server port
   * @param {Buffer} opts.handshakeKey Server handshake key
   * @param {Buffer} opts.salt SRP authentication salt
   * @param {Buffer} opts.identity SRP identity
   * @param {Buffer} opts.password SRP password
   * @param {object} opts.sessionOptions Session options
   */
  constructor(opts: { host: string; port: number; handshakeKey: Buffer; salt: Buffer; identity: Buffer; password: Buffer; sessionOptions: SessionOptions }) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.handshakeKey = opts.handshakeKey;
    this.salt = opts.salt;
    this.identity = opts.identity;
    this.password = opts.password;
    this.sessionOptions = undefined;

    this.session = new Session(this.sessionOptions);
  }

  /**
   * Adds connection to this.connections and adds event listeners
   * @param {ClientConnection} connection
   */
  _handleConnect(connection: ClientConnection) {
    this.session.addConnection(connection);
    connection.on('close', () => this.session.removeConnection(connection));
  }

  /** Do initial connection to server */
  async connect() {
    let connection = new ClientConnection({
      host: this.host,
      port: this.port,
      mode: constants.ConnectionModes.INIT as ClientHandshakeKeys,
      handshakeKey: this.handshakeKey,
      salt: this.salt,
      identity: this.identity,
      password: this.password
    });
    await connection.connect();
    // connected to server
    this.session.connected = true;
    this.session.sessionId = connection.sessionId;
    this.session.sessionIdN = connection.sessionIdN;
    this._handleConnect(connection);
  }

  /** Add a connection to the session */
  async addConnection() {
    if (!this.session.connected) throw errCode('Not connected', 'NOT_CONNECTED');
    let connection = new ClientConnection({
      host: this.host,
      port: this.port,
      mode: constants.ConnectionModes.RESUME as ClientHandshakeKeys,
      sessionId: this.session.sessionId,
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
    this.session.close();
  }
}

type ClientHandshakeKeys = keyof typeof constants.ClientHandshake

/** Represents one connection in the session */
class ClientConnection extends EventEmitter {
  host: string;
  port: number;
  handshakeKey: Buffer;
  salt: Buffer;
  identity: Buffer;
  password: Buffer;
  mode: ClientHandshakeKeys;
  sessionId: Buffer | null;
  sessionIdN: number | null;
  socket: net.Socket | null;
  consumer: StreamConsumer | null;
  clientMessageCounter: number;
  serverMessageCounter: number;
  serverNonce: Buffer | null;
  clientNonce: Buffer | null;
  srpClient: srp.Client | null;
  sessionKey: Buffer | null;
  state: symbol;
  socketError: Error | null;
  localPort: number | null;
  ready: boolean;
  readStreamWrap: any;
  /**
   * The constructor
   * @param {object} opts
   * @param {string} opts.host Server hostname
   * @param {number} opts.port Server port
   * @param {symbol} opts.mode Connection mode, one of constants.connectionModes
   * @param {Buffer} [opts.sessionId] Session id, specify with mode RESUME
   * @param {Buffer} opts.handshakeKey Server handshake key
   * @param {Buffer} opts.salt SRP authentication salt
   * @param {Buffer} opts.identity SRP identity
   * @param {Buffer} opts.password SRP password
   */
  constructor(opts: { host: string; port: number; mode: ClientHandshakeKeys; sessionId?: Buffer | null; handshakeKey: Buffer; salt: Buffer; identity: Buffer; password: Buffer }) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.handshakeKey = opts.handshakeKey;
    this.salt = opts.salt;
    this.identity = opts.identity;
    this.password = opts.password;
    this.mode = opts.mode;
    this.sessionId = opts.sessionId || null;
    this.sessionIdN = this.sessionId && this.sessionId.readUInt32BE(0);

    this.socket = null;
    this.consumer = null;
    this.clientMessageCounter = 0;
    this.serverMessageCounter = 0;
    this.serverNonce = null;
    this.clientNonce = null;
    this.srpClient = null;
    this.sessionKey = null;
    this.state = ConnectionStates.DISCONNECTED;
    this.socketError = null;
    // for debugging and connection identification
    this.localPort = null;
    // flow control: whether or not this connection should be written to
    this.ready = false;
    this.readStreamWrap = null;

    this.debugLog(`init: mode ${(this.mode as symbol).description} to ${this.host}:${this.port}`);
  }
  /**
   * Log a debug message
   * @param {string} message
   */
  debugLog(message: string) {
    if (!process.env.DEBUG) return;
    debug(`[${this.localPort}/${this.sessionIdN}] ${message}`);
  }
  /**
   * Set state of connection and emit event
   * @param {symbol} state One of constants.ConnectionState
   */
  setState(state: symbol) {
    this.debugLog(`state ${this.state.description} => ${state.description}`);
    this.state = state;
    this.emit('stateChange', state);
  }
  /**
   * Send an encrypted message
   * @param {Buffer} buffer
   * @return {boolean} Whether or not data should continue to be written
   */
  sendMessage(buffer: Buffer) {
    if (this.state !== ConnectionStates.CONNECTED) throw new Error('Not connected');
    if (buffer.length > 65535) throw new Error('Buffer is too long');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.clientNonce!.copy(nonce);
    nonce.writeUIntBE(this.clientMessageCounter, 6, 6);
    this.clientMessageCounter++;
    // encrypted message
    let encrypted = aeadEncrypt(this.sessionKey!, nonce, buffer);
    return this.ready = this.socket!.write(encrypted);
  }
  /**
   * Get the next message
   * @return {Buffer}
   */
  async readMessage() {
    if (this.state !== ConnectionStates.CONNECTED) throw new Error('Not connected');
    // nonce
    let nonce = Buffer.allocUnsafe(12);
    this.serverNonce!.copy(nonce);
    nonce.writeUIntBE(this.serverMessageCounter, 6, 6);
    this.serverMessageCounter++;
    // decrypt message
    try {
      return await aeadDecryptNext(this.sessionKey!, nonce, this.consumer!);
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
    this.setState(ConnectionStates.DISCONNECTED);
    this.ready = false;
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
   * @param {string} message Error message
   * @param {string} code Error code (in error.code)
   * @return {Error}
   */
  destroyWithError(message: string, code?: string) {
    this.debugLog('destroy ' + message);
    let error = new CustomError(message);
    if (code) error.code = code;
    this.socket!.destroy(error);
    return error;
  }
  /** Connect to the server */
  async connect() {
    if (this.state !== ConnectionStates.DISCONNECTED) throw new Error('Not disconnected');
    this.setState(ConnectionStates.CONNECTING);
    this.socket = new net.Socket();
    this.socketError = null;
    let clientHandshakeNonce = crypto.randomBytes(12);
    this.clientNonce = clientHandshakeNonce.slice(0, 6);
    this.socket.on('drain', () => {
      this.ready = true;
      this.emit('drain');
    });
    // the 'close' event comes after the 'error' event
    this.socket.on('error', err => {
      this.socketError = err;
      this.debugLog('error ' + err);
      this.emit('socketError', err);
    });
    // if remote wants to end connection then we should stop sending data
    this.socket.on('end', () => this.ready = false);
    this.socket.on('close', errored => {
      this._handleClose();
      this.debugLog('close');
      this.emit('close', errored ? this.socketError : null);
    });
    // what follows is a humongous mess which attempts to throw an error
    // into this function if the connection dies during handshake
    await (() => new Promise((resolve, reject) => {
      let cleanUpEventHandlers = () => {
        this.socket!.removeListener('connect', connectHandler);
        this.socket!.removeListener('close', closeHandler);
      };
      let connectHandler = () => {
        this.localPort = this.socket!.localPort;
        cleanUpEventHandlers();
        resolve();
      };
      let closeHandler = () => {
        cleanUpEventHandlers();
        reject(this.socketError);
      };
      this.socket!.on('connect', connectHandler);
      this.socket!.on('close', closeHandler);
      this.debugLog('socket connecting');
      this.socket!.connect(this.port, this.host);
    }))();
    this.debugLog('socket connected');
    this.consumer = new StreamConsumer(this.socket);
    // do handshake
    this.setState(ConnectionStates.HANDSHAKING);
    // init local SRP state
    let srpClientSecret = crypto.randomBytes(32);
    this.srpClient = new srp.Client(
      SRP_PARAMS, this.salt, this.identity, this.password, srpClientSecret
    );
    let srpA = this.srpClient!.computeA();
    /* Handshake length
       Identity length: 1 byte
       Identity: 1-255 bytes
       Mode: 1 byte
       Session identifier (optional): 4 bytes
       SRP A: 256 bytes

       Total: 258 + identity length + 4 if Mode is RESUME */
    let clientMessage = Buffer.alloc(int(258 + this.identity.length +
      (this.mode === ConnectionModes.RESUME ? 4 : 0), 1400));
    let offset = 0;
    clientMessage[offset++] = this.identity.length; // identity length
    offset += this.identity.copy(clientMessage, offset);
    clientMessage[offset++] = constants.ClientHandshake[this.mode]; // mode
    if (this.mode === ConnectionModes.RESUME) {
      offset += this.sessionId!.copy(clientMessage, offset);
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
      case constants.ServerHandshake.OK:
        // everything is good
        break;
      case constants.ServerHandshake.INVALID_SESSION:
        throw this.destroyWithError('Session identifier is invalid');
      case constants.ServerHandshake.INVALID_IDENTITY:
        throw this.destroyWithError('Invalid identity');
      default:
        throw this.destroyWithError('Invalid server response');
    }
    this.debugLog('no error from server');
    this.sessionId = Buffer.from(serverMessage.slice(1, 5));
    this.sessionIdN = this.sessionId.readUInt32BE(0);
    this.srpClient!.setB(serverMessage.slice(5, 261));
    this.sessionKey = this.srpClient!.computeK();
    // GC the SRP instance
    this.srpClient = null;
    this.ready = true;
    this.setState(ConnectionStates.CONNECTED);
    this.emit('connected');
  }

  /** Close this connection */
  close() {
    this.socket!.end();
  }
}

export {
  Client,
  ClientConnection
};
