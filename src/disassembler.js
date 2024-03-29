/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
const Fragment = require('./fragment.js');
const { CircularBuffer } = require('./utils.js');
const random = require('./random.js');
const stream = require('stream');

let debug;
if (process.env.DEBUG) debug = require('debug')('ahj:disassembler');
else debug = () => {};

/** @typedef {import('./connection.js')} Connection */

/** Represents an outgoing message that may be split into fragments */
class OutgoingMessage {
  /**
   * The constructor
   * @param {Buffer} message Buffer of original message
   * @param {number} id Fragment identifier
   */
  constructor(message, id) {
    this.message = message;
    this.length = message.length;
    this.id = id;
    this.offset = 0;
    this.fragIndex = 0;
  }

  /**
   * Get how many bytes are left in the message
   * @return {number}
   */
  get remainingLength() {
    return this.message.length - this.offset;
  }

  /**
   * Get a fragment of a specified size
   * @param {number} [bytes] Size of fragment. If not specified, defaults to
   *  all remaining bytes
   * @return {Fragment}
   */
  getFragment(bytes = this.remainingLength) {
    let slice = this.message.slice(this.offset, this.offset + bytes);
    this.offset += bytes;
    let isLast = this.offset >= this.message.length;
    let fragment = new Fragment(this.id, this.fragIndex, isLast, slice);
    this.fragIndex++;
    return fragment;
  }
}

/** Disassembles messages into fragments */
class Disassembler extends stream.Writable {
  /**
   * The constructor
   * @param {Connection[]} connections List of connections
   * @param {object} opts Additional options
   * @param {number} [opts.bufferLength=1000] Buffer length, in number of messages
   * @param {number} [opts.fragmentBufferLength=15] Length of fragment buffer
   * @param {number} [opts.leastBytesPerConn=64] Lower limit of the number of bytes
   *  that should be sent per connection per tick
   * @param {number} [opts.leastFragmentLength=16] Don't send fragments shorter than
   *  this amount
   */
  constructor(connections, opts) {
    super({ objectMode: true });
    this.opts = opts = Object.assign({
      bufferLength: 1000,
      fragmentBufferLength: 15,
      leastBytesPerConn: 64,
      leastFragmentLength: 16
    }, opts);
    /**
     * Connections to be used by the disassembler
     * @type {Connection[]}
     */
    this.connections = connections;
    /**
     * Next fragment index
     * @type {number}
     */
    this.fragmentIndex = 1;
    /**
     * Array of currently used fragment ids and messages
     * @type {OutgoingMessage[]}
     */
    this.fragmentCache = new Array(256);
    /**
     * Circular buffer of messages to be sent
     * @type {CircularBuffer<Buffer>}
     */
    this.messageBuffer = new CircularBuffer(opts.bufferLength);
    /**
     * Number of bytes in the message buffer
     * @type {number}
     */
    this.bufferBytes = 0;
    /**
     * Circular buffer containing half fragments
     * @type {CircularBuffer<OutgoingMessage>}
     */
    this.fragmentBuffer = new CircularBuffer(opts.fragmentBufferLength);
    /**
     * Number of bytes in the partially sent fragment buffer
     * @type {number}
     */
    this.fragmentBufferBytes = 0;
  }

  /**
   * Add a message to be sent
   * @param {Buffer} message
   * @return {boolean} Whether or not data should continue to be written
   */
  add(message) {
    if (!(message instanceof Buffer)) throw new Error('Expected buffer');
    if (this.messageBuffer.push(message)) {
      this.bufferBytes += message.length + 5;
      debug(`adding message of length ${message.length} ` +
        `(total bytes in buffer: ${this.bufferBytes})`);
      return true;
    } else return false;
  }

  /**
   * Node.js Writable stream _write method
   * @param {Buffer} chunk
   * @param {string} _encoding Not used
   * @param {Function} callback
   * @return {undefined}
   */
  _write(chunk, _encoding, callback) {
    if (this.add(chunk)) return callback();
    // could not be added to current send buffer, try again when tick occurs
    this.once('dataSent', this._write.bind(this, chunk, _encoding, callback));
  }

  /**
   * Get the next available fragment id
   * @return {number}
   */
  getNextFragId() {
    // try 255 times to get an unused fragment id
    for (let i = 0; i < 255; i++) {
      let ret;
      // check wheteher or not fragment id is being used
      if (!this.fragmentCache[this.fragmentIndex]) ret = this.fragmentIndex;
      this.fragmentIndex++;
      if (this.fragmentIndex > 255) this.fragmentIndex = 1;
      if (ret) return ret;
    }
    throw new Error('No available fragment ids. This should not happen');
  }

  /** Do stuff */
  tick() {
    let activeConnections = this.connections.filter(c => c.ready);
    if (!activeConnections.length) return;
    let totalBytes = this.bufferBytes + this.fragmentBufferBytes;
    if (!totalBytes) return;
    let perConnection = totalBytes / activeConnections.length;
    if (perConnection < this.opts.leastBytesPerConn) {
      // we would be sending less than leastBytesPerConn bytes per connection
      let numConnections = Math.ceil(totalBytes / this.opts.leastBytesPerConn);
      activeConnections = random.choose(activeConnections, numConnections);
      // recompute per connection bytes
      perConnection = totalBytes / activeConnections.length;
    }
    debug(`using ${activeConnections.length} connections to send ` +
      `approximately ${totalBytes} bytes (${perConnection} per connection)`);
    let totalSent = 0;
    let dataSent = 0;
    let shouldContinue = true;
    for (let i = 0; i < activeConnections.length; i++) {
      let allocated = Math.round(random.normal(perConnection, perConnection / 10));
      // each data packet can only hold a maximum of 65535 bytes
      if (allocated > 65535) allocated = 65535;
      if (allocated <= 5) continue;
      debug(`sending ${allocated} bytes over connection ${i}`);
      let buf = Buffer.alloc(allocated);
      let used = 0;
      // go through fragment buffer first
      while (used < allocated) {
        // frag header is 5 bytes
        let next = this.fragmentBuffer.peek();
        if (!next) break;
        if (next.remainingLength + 5 <= allocated - used) {
          // it fits completely
          let fragment = next.getFragment();
          let copied = fragment.toBuffer().copy(buf, used);
          debug(`writing rest of fragment ${fragment.id} ` +
          `(${copied} bytes, index ${fragment.index})`);
          used += copied;
          this.fragmentBufferBytes -= copied;
          this.fragmentBuffer.pop();
          // free fragment id
          this.fragmentCache[next.id] = null;
        } else {
          // don't send stupidly small fragments
          if (allocated - used < this.opts.leastFragmentLength) {
            debug(`available space (${allocated - used} bytes) too small`);
            shouldContinue = false;
            break;
          }
          let fragment = next.getFragment(allocated - used - 5);
          let copied = fragment.toBuffer().copy(buf, used);
          debug(`writing partial fragment ${fragment.id} ` +
            `(${copied} bytes, index ${fragment.index})`);
          used += copied;
          // don't count the fragment header
          this.fragmentBufferBytes -= copied - 5;
          // allocated is now full
          break;
        }
      }
      while (used < allocated && shouldContinue) {
        // frag header is 5 bytes
        let next = this.messageBuffer.peek();
        if (!next) break;
        if (next.length + 5 <= allocated - used) {
          let fragment = new Fragment(0, 0, true, next);
          let copied = fragment.toBuffer().copy(buf, used);
          debug(`writing entire message (${copied} bytes)`);
          used += copied;
          this.bufferBytes -= copied;
          this.messageBuffer.pop();
        } else {
          if (allocated - used < this.opts.leastFragmentLength) {
            debug(`available space (${allocated - used} bytes) too small`);
            break;
          }
          // add to fragment buffer
          this.bufferBytes -= next.length + 5;
          this.fragmentBufferBytes += next.length + 5;
          let message = new OutgoingMessage(next, this.getNextFragId());
          this.messageBuffer.pop();
          // put message in incomplete messages buffer
          this.fragmentBuffer.push(message);
          // occupy fragment id
          this.fragmentCache[message.id] = message;
          let fragment = message.getFragment(allocated - used - 5);
          let copied = fragment.toBuffer().copy(buf, used);
          debug(`splitting message to fragment ${fragment.id} (sent ` +
            `${copied} bytes, stored ${message.remainingLength + 5} bytes)`);
          used += copied;
          this.fragmentBufferBytes -= copied - 5;
          break;
        }
      }

      // edge case: random says to send less bytes than actual message length,
      // message is small enough that splitting is considered against
      // result: a whole lot of nothing gets sent
      // FIXME: there's probably a better way to do this
      if (!used) continue;

      // this is slow
      // debug(`sending ${util.inspect(buf)} over conn ${i}`);
      totalSent += allocated;
      dataSent += used;
      activeConnections[i].sendMessage(buf);
    }
    if (totalSent) {
      debug(`sent ${totalSent} bytes total, ${dataSent} bytes useful data ` +
        `(${dataSent / totalSent * 100}% efficiency)`);
      process.nextTick(() => this.emit('dataSent'));
    }
  }
}

exports.OutgoingMessage = OutgoingMessage;
exports.Disassembler = Disassembler;
