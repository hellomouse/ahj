const EventEmitter = require('events');
const stream = require('stream');
const utils = require('./utils.js');
const random = require('./random.js');
const debug = require('debug')('ahj:data');

// the following imports are for vscode code intelligence
/* eslint-disable no-unused-vars */
const {
  ServerSession,
  ServerConnection
} = require('./server.js');
const {
  Client,
  ClientConnection
} = require('./client.js');
/* eslint-enable no-unused-vars */

/** Represents a Fragment (a part of a message) */
class Fragment {
  /**
   * The constructor
   * @param {Number} id Fragment identifier (0-255)
   * @param {Number} index Fragment index (0-255)
   * @param {Boolean} isLast Whether or not this fragment is the last
   * @param {Buffer} data Data
   */
  constructor(id, index, isLast, data) {
    this.id = id;
    this.index = index;
    this.isLast = isLast;
    this.data = data;
    this.length = data.length;
  }

  /**
   * Convert instance to a Buffer
   * @return {Buffer}
   */
  toBuffer() {
    return Buffer.concat([
      Buffer.from([
        this.id,
        this.index,
        // big endian
        this.length >> 8,
        this.length & 255,
        this.isLast ? 1 : 0
      ]),
      this.data
    ]);
  }

  /**
   * Create an instance from a buffer
   * @param {Buffer} buf
   * @return {Fragment}
   */
  static fromBuffer(buf) {
    let id = buf[0];
    let index = buf[1];
    let length = buf.readUInt16BE(2);
    let isLast = Boolean(buf[4]);
    let data = buf.slice(5, 5 + length);
    return new Fragment(id, index, isLast, data);
  }

  /**
   * Process multiple fragments from a buffer
   * @param {Buffer} buf
   * @return {Fragment[]} Extracted fragments
   */
  static fromMany(buf) {
    let offset = 0;
    let ret = [];
    while (offset + 5 < buf.length) {
      let id = buf[offset + 0];
      let index = buf[offset + 1];
      let length = buf.readUInt16BE(offset + 2);
      if (!length) return ret;
      let isLast = Boolean(buf[offset + 4]);
      let data = buf.slice(offset + 5, offset + 5 + length);
      ret.push(new Fragment(id, index, isLast, data));
      offset += length + 5;
    }
    return ret;
  }
}

/** Represents an outgoing message that may be split into fragments */
class OutgoingMessage {
  /**
   * The constructor
   * @param {Buffer} message Buffer of original message
   * @param {Number} id Fragment identifier
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
   * @return {Number}
   */
  get remainingLength() {
    return this.message.length - this.offset;
  }

  /**
   * Get a fragment of a specified size
   * @param {Number} [bytes] Size of fragment. If not specified, defaults to
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
class Disassembler {
  /**
   * The constructor
   * @param {ClientConnection[]|ServerConnection[]} connections List of connections
   * @param {Object} opts Additional options
   * @param {Number} [opts.bufferLength=1000] Buffer length, in number of messages
   * @param {Number} [opts.fragmentBufferLength=15] Length of fragment buffer
   * @param {Number} [opts.leastBytesPerConn=64] Lower limit of the number of bytes
   *  that should be sent per connection per tick
   * @param {Number} [opts.leastFragmentLength=16] Don't send fragments shorter than
   *  this amount
   */
  constructor(connections, opts) {
    this.opts = opts = Object.assign({
      bufferLength: 1000,
      fragmentBufferLength: 15,
      leastBytesPerConn: 64,
      leastFragmentLength: 16
    }, opts);
    this.connections = connections;
    this.fragmentIndex = 1;
    this.fragmentCache = [];
    this.bufferBytes = 0;
    this.messageBuffer = new utils.CircularBuffer(opts.bufferLength);
    this.fragmentBufferBytes = 0;
    // contains OutgoingMessage instances
    this.fragmentBuffer = new utils.CircularBuffer(opts.fragmentBufferLength);
  }

  /**
   * Debug logging
   * @param {String} message
   */
  debugLog(message) {
    debug('[disassembler] ' + message);
  }

  /**
   * Add a message to be sent
   * @param {Buffer} message
   * @return {Boolean} Whether or not data should continue to be written
   */
  add(message) {
    if (this.messageBuffer.push(message)) {
      this.bufferBytes += message.length + 5;
      this.debugLog(`adding message of length ${message.length} ` +
        `(total bytes in buffer: ${this.bufferBytes})`);
      return true;
    } else return false;
  }

  /**
   * Get the next available fragment id
   * @return {Number}
   */
  getNextFragId() {
    for (let i = 0; i < 255; i++) {
      let ret;
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
    this.debugLog(`using ${activeConnections.length} connections`);
    for (let i = 0; i < activeConnections.length; i++) {
      // TODO: replace with normal distribution maybe
      let allocated = Math.round(perConnection * random.double(0.9, 1.1));
      this.debugLog(`sending ${allocated} bytes over connection ${i}`);
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
          this.debugLog(`writing rest of fragment ${fragment.id} ` +
            `(index ${fragment.index})`);
          let copied = fragment.toBuffer().copy(buf, used);
          used += copied;
          this.fragmentBufferBytes -= copied;
          this.fragmentBuffer.pop();
          this.fragmentCache[next.id] = null;
        } else {
          // don't send stupidly small fragments
          if (next.remainingLength + 5 < this.opts.leastFragmentLength) {
            this.debugLog(`available space less than leastFragmentLength`);
            used = allocated;
            break;
          }
          let fragment = next.getFragment(allocated - used - 5);
          this.debugLog(`writing partial fragment ${fragment.id} ` +
            `index ${fragment.index}`);
          let copied = fragment.toBuffer().copy(buf, used);
          used += copied;
          // don't count the fragment header
          this.fragmentBufferBytes -= copied - 5;
          // allocated is now full
          break;
        }
      }
      while (used < allocated) {
        // frag header is 5 bytes
        let next = this.messageBuffer.peek();
        if (!next) break;
        if (next.length + 5 <= allocated - used) {
          this.debugLog('writing entire message');
          let fragment = new Fragment(0, 0, true, next);
          let copied = fragment.toBuffer().copy(buf, used);
          used += copied;
          this.bufferBytes -= copied;
          this.messageBuffer.pop();
        } else {
          if (next.length + 5 < this.opts.leastFragmentLength) break;
          // add to fragment buffer
          this.bufferBytes -= next.length + 5;
          this.fragmentBufferBytes += next.length + 5;
          let m = new OutgoingMessage(next, this.getNextFragId());
          this.messageBuffer.pop();
          this.fragmentBuffer.push(m);
          let fragment = m.getFragment(allocated - used - 5);
          this.debugLog(`splitting message to fragment ${fragment.id}`);
          let copied = fragment.toBuffer().copy(buf, used);
          used += copied;
          this.fragmentBufferBytes -= copied - 5;
          break;
        }
      }
      this.debugLog(`sending ${require('util').inspect(buf)} over conn ${i}`);
      activeConnections[i].sendMessage(buf);
    }
  }
}

/** Represents a message of several fragments */
class PartialMessage {
  /**
   * The constructor
   * @param {Number} id Message identifier
   */
  constructor(id) {
    this.id = id;
    /** @type {Fragment[]} */
    this.fragments = [];
    this.hasLastFragment = false;
    this.currentFragments = 0;
    this.totalFragments = null;
    this.finished = false;
    this.reassembled = null;
  }

  /**
   * Process a new fragment
   * @param {Fragment} fragment
   * @return {Boolean} True if finished, false if not yet
   */
  processNewFragment(fragment) {
    this.fragments[fragment.index] = fragment;
    this.currentFragments++;
    if (fragment.isLast) {
      this.hasLastFragment = true;
      this.totalFragments = fragment.index + 1;
    }
    if (this.hasLastFragment && this.currentFragments === this.totalFragments) {
      this.finished = true;
      this.reassembled = Buffer.concat(this.fragments.map(frag => frag.data));
      return true;
    }
    return false;
  }
}

/** Reassembles messages from fragments */
class Reassembler extends stream.Transform {
  /**
   * The constructor
   * @param {Number} [bufferLength=32] Length of internal buffer
   */
  constructor(bufferLength = 32) {
    super({ objectMode: true, highWaterMark: bufferLength });
    /** @type {PartialMessage[]} */
    this.fragmentCache = [];
  }

  /**
   * Debug logging
   * @param {String} message
   */
  debugLog(message) {
    debug('[reassembler] ' + message);
  }

  /**
   * Process new data
   * @param {Buffer} data
   * @param {String} encoding Not used
   * @param {Function} callback
   */
  _transform(data, encoding, callback) {
    let fragments = Fragment.fromMany(data);
    for (let fragment of fragments) {
      let partial = this.fragmentCache[fragment.id];
      if (!partial) {
        this.debugLog(`processing new fragment ${fragment.id}`);
        partial = this.fragmentCache[fragment.id] =
          new PartialMessage(fragment.id);
      } else this.debugLog(`processing continuation of fragment ${fragment.id}`);
      partial.processNewFragment(fragment);
      if (partial.finished) {
        this.debugLog(`fragment ${fragment.id} done`);
        this.fragmentCache[fragment.id] = null;
        this.push(partial.reassembled);
      }
    }
    callback(null);
  }
}

/** Server-side connection data handler */
class ServerDataHandler extends EventEmitter {
  /**
   * The constructor
   * @param {ServerSession} session The session
   */
  constructor(session) {
    super();
    this.session = session;
  }

  /**
   * Process new data
   * @param {Buffer} data Incoming data to process
   */
  async processData(data) {

  }
}

/** Client-side connection data handler */
class ClientDataHandler extends EventEmitter {

}

module.exports = {
  Fragment,
  PartialMessage,
  OutgoingMessage,
  Disassembler,
  Reassembler,
  ServerDataHandler,
  ClientDataHandler
};
