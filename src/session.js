const EventEmitter = require('events');
const utils = require('./utils.js');
const { Disassembler } = require('./disassembler.js');
const { Reassembler } = require('./reassembler.js');
const Channel = require('./channels.js').Channel;

/** @typedef {import('./client.js').ClientConnection} ClientConnection */
/** @typedef {import('./server.js').ServerConnection} ServerConnection */
/** @typedef {ClientConnection|ServerConnection} Connection */

/** Represents one session composed of many connections */
class Session extends EventEmitter {
  /**
   * The constructor
   * @param {object} opts
   * @param {number} opts.sessionId Numerical session id of this session
   * @param {object} opts.disassemblerOptions
   * @param {object} opts.reassemblerOptions
   * @param {number} opts.reassemblerOptions.bufferLength
   */
  constructor(opts) {
    super();
    this.connected = false;
    opts = Object.assign({
      sessionId: null,
      disassemblerOptions: {},
      reassemblerOptions: {}
    }, opts);
    this.sessionId = opts.sessionId;
    this.connections = [];
    this.disassembler = new Disassembler(this.connections, opts.disassemblerOptions);
    this.reassembler = new Reassembler(opts.reassemblerOptions.bufferLength);
    /** @type {Map<number, Channel>} */
    this.channels = new Map();
  }

  /**
   * Add a connection to this session
   * @param {Connection} conn
   */
  addConnection(conn) {
    if (this.connections.includes(conn)) throw new Error('Already exists!');
    this.connections.push(conn);
    conn.readStreamWrap = new utils.ConnectionReadStreamWrap(conn);
    conn.readStreamWrap.pipe(this.reassembler);
    this.emit('addConnection', conn);
  }

  /**
   * Remove a connection from this session
   * @param {Connection} conn
   */
  removeConnection(conn) {
    if (conn.readStreamWrap) conn.readStreamWrap.unpipe(this.reassembler);
    conn.readStreamWrap = null;
    let index = this.connections.indexOf(conn);
    if (index < 0) throw new Error('No such connection');
    this.connections.splice(index, 1);
    this.emit('removeConnection', conn);
    if (!this.connections.length) {
      this.connected = false;
      this.sessionId = null;
      this.emit('end');
    }
  }

  /** End all connections */
  close() {
    for (let connection of this.connections) connection.socket.end();
  }
}

module.exports = Session;