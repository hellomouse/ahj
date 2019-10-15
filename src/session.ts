/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import EventEmitter from 'events';
import { ConnectionReadStreamWrap } from './utils';
import { Disassembler } from './disassembler';
import { Reassembler } from './reassembler';
import { ChannelHandler } from './channels';
import { ClientConnection } from './client';
import { ServerConnection } from './server';
/** @typedef {import('./client.js').ClientConnection} ClientConnection */
/** @typedef {import('./server.js').ServerConnection} ServerConnection */
/** @typedef {ClientConnection|ServerConnection} Connection */
/** @typedef {import('./channels.js').Channel} Channel */
export type Connection = ClientConnection | ServerConnection
export interface SessionOptions {
  sessionId?: Buffer,
  sessionIdN?: number,
  disassemblerOptions?: any,
  reassemblerOptions?: { bufferLength: number }
}

/** Represents one session composed of many connections */
class Session extends EventEmitter {
  connected: boolean;
  sessionId: Buffer | null;
  sessionIdN: number | null;
  connections: any[];
  disassembler: Disassembler;
  reassembler: Reassembler;
  channelHandler: ChannelHandler;
  channels: any;
  /**
   * The constructor
   * @param {object} opts
   * @param {Buffer} opts.sessionId Session id of this session
   * @param {number} opts.sessionIdN Numerical session id of this session
   * @param {object} opts.disassemblerOptions
   * @param {object} opts.reassemblerOptions
   * @param {number} opts.reassemblerOptions.bufferLength
   */
  constructor(opts?: SessionOptions) {
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
    this.reassembler = new Reassembler(opts.reassemblerOptions!.bufferLength);
    // vscode pls this is obvious
    /** @type {ChannelHandler} */
    this.channelHandler = new ChannelHandler({
      session: this
    });
    this.channels = this.channelHandler.channels;
    this.reassembler.pipe(this.channelHandler, { end: false });
    this.channelHandler.pipe(this.disassembler, { end: false });
    // also emit events on session instance
    for (let event of [
      'localOpenedChannel', 'remoteOpenedChannel', 'channelOpened'
    ]) this.channelHandler.on(event, channel => this.emit(event, channel));
  }

  /**
   * Add a connection to this session
   * @param {Connection} conn
   */
  addConnection(conn: Connection) {
    if (this.connections.includes(conn)) throw new Error('Already exists!');
    this.connections.push(conn);
    conn.readStreamWrap = new ConnectionReadStreamWrap(conn);
    conn.readStreamWrap.pipe(this.reassembler, { end: false });
    this.emit('addConnection', conn);
  }

  /**
   * Remove a connection from this session
   * @param {Connection} conn
   */
  removeConnection(conn: Connection) {
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

export default Session;
