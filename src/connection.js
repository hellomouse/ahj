/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
const EventEmitter = require('events');
const constants = require('./constants.js');
const debug = require('debug')('ahj:connection');

const ConnectionStates = constants.ConnectionStates;

/** @typedef {import('./session.js')} Session */
/** @typedef {import('./transport.js')} Transport */
/** @typedef {import('./constants.js').ConnectionStates} ConnectionStates */
/** @typedef {import('./constants.js').ConnectionModes} ConnectionModes */
/** @typedef {import('./utils.js').ConnectionReadStreamWrap} ConnectionReadStreamWrap */

/** Represents a connection */
class Connection extends EventEmitter {
  /**
   * The constructor
   * @param {object} opts
   * @param {ConnectionModes} [opts.mode] Connection mode, one of constants.connectionModes
   * @param {Session} [opts.session] Session of the connection
   * @param {Transport} [opts.transport] Transport managing this connection
   */
  constructor(opts) {
    super();
    /**
     * Connection session establishment mode, either INIT or RESUME
     * @type {ConnectionModes}
     */
    this.mode = opts.mode || null;
    /**
     * State of the connection
     * @type {ConnectionStates}
     */
    this.state = ConnectionStates.DISCONNECTED;
    /**
     * Whether or not this connection should be written to
     * @type {boolean}
     */
    this.ready = false;
    /**
     * Transport managing this connection
     * @type {Transport}
     */
    this.transport = opts.transport || null;
    /**
     * Associated session
     * @type {Session}
     */
    this.session = opts.session || null;
    /**
     * Session id of this connection
     * @type {Buffer}
     */
    this.sessionId = null;
    /**
     * Numeric session id
     * @type {number}
     */
    this.sessionIdN = null;
    /**
     * An unsigned integer up to 6 bytes that uniquely identifies the connection
     * @type {number}
     */
    this.identifier = null;
    /**
     * stream.Readable wrapper for this connection, set by Session
     * @type {ConnectionReadStreamWrap}
     */
    this.readStreamWrap = null;
  }
  /**
   * Log a debug message
   * @param {string} message
   */
  debugLog(message) {
    if (!process.env.DEBUG) return;
    debug(`[${this.sessionIdN}] ${message}`);
  }
  /**
   * Set state of connection
   * @param {ConnectionStates} state New state
   */
  setState(state) {
    this.debugLog(`state ${this.state.toString()} => ${state.toString()}`);
    this.state = state;
    this.emit('stateChange', state);
  }
  /**
   * Send a message over the connection
   * @abstract
   * @param {Buffer} buffer
   * @return {boolean} Whether or not data should continue to be written
   */
  sendMessage(buffer) {
    throw new Error('not implemented');
  }
  /**
   * Get the next message, or false if the connection has already ended
   * @abstract
   * @return {Promise<Buffer | boolean>}
   */
  async readMessage() {
    throw new Error('not implemented');
  }
  /**
   * Do connection to server
   * Will not be implemented in Connection implementations for the server
   * @abstract
   */
  async connect() {
    throw new Error('not supported');
  }
  /**
   * Close this connection
   * @abstract
   */
  close() {
    throw new Error('not implemented');
  }
}

module.exports = Connection;
