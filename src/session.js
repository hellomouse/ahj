const EventEmitter = require('events');
const utils = require('./utils.js');
const { Disassembler } = require('./disassembler.js');
const { Reassembler } = require('./reassembler.js');
const { ChannelHandler } = require('./channels.js');

/** @typedef {import('./client.js').ClientConnection} ClientConnection */
/** @typedef {import('./server.js').ServerConnection} ServerConnection */
/** @typedef {ClientConnection|ServerConnection} Connection */
/** @typedef {import('./channels.js').Channel} Channel */

/** Represents one session composed of many connections */
class Session extends EventEmitter {
  /**
   * The constructor
   * @param {object} opts
   * @param {Buffer} opts.sessionId Session id of this session
   * @param {number} opts.sessionIdN Numerical session id of this session
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
    this.sessionId = opts.sessionId || null;
    this.sessionIdN = opts.sessionIdN || null;
    this.connections = [];
    this.disassembler = new Disassembler(this.connections, opts.disassemblerOptions);
    this.reassembler = new Reassembler(opts.reassemblerOptions.bufferLength);
    // vscode pls this is obvious
    /** @type {ChannelHandler} */
    this.channelHandler = new ChannelHandler({
      session: this
    });
    this.channels = this.channelHandler.channels;
    this.reassembler.pipe(this.channelHandler).pipe(this.disassembler);
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
      this.emit('end');
      this.sessionId = null;
    }
  }

  /**
   * Wrapper around ChannelHandler#createChannel
   * @return {Promise<Channel>}
   */
  createChannel() {
    return this.channelHandler.createChannel();
  }

  /** End all connections */
  close() {
    for (let connection of this.connections) connection.socket.end();
  }
}

module.exports = Session;
