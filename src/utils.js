// random useful stuff
const stream = require('stream');

/**
 * Create a new Error with a code
 * @param {String} message Error message
 * @param {String} code Error code
 * @return {Error}
 */
function errCode(message, code) {
  let error = new Error(message);
  error.code = code;
  return error;
}

/** Circular buffer implementation */
class CircularBuffer {
  /**
   * The constructor
   * @param {Number} size How large the buffer should be
   */
  constructor(size) {
    this.size = size;
    this.empty();
  }

  /** Empty the buffer */
  empty() {
    this.array = new Array(this.size).fill(null);
    this.count = 0;
    this.read = null;
    this.write = 0;
  }

  /**
   * Whether or not the buffer is full
   * @return {Boolean}
   */
  isFull() {
    return this.write === null;
  }

  /**
   * Whether or not the buffer is empty
   * @return {Boolean}
   */
  isEmpty() {
    return this.read === null;
  }

  /**
   * Add an item to the buffer
   * @param {any} item
   * @return {Boolean} True if added, false if full
   */
  push(item) {
    if (this.write === null) return false;
    this.count++;
    this.array[this.write] = item;
    // if read pointer is null, set to position of current item
    if (this.read === null) this.read = this.write;
    this.write = (this.write + 1) % this.array.length;
    // buffer is now full
    if (this.write === this.read) this.write = null;
    return true;
  }

  /**
   * Remove the last item from the buffer
   * @return {any} The item, or null if the buffer is empty
   */
  pop() {
    if (this.read === null) return null;
    this.count--;
    let ret = this.array[this.read];
    this.array[this.read] = null; // allow item to be garbage collected
    // if buffer was full, set write pointer to current position
    if (this.write === null) this.write = this.read;
    this.read = (this.read + 1) % this.array.length;
    // buffer is now empty
    if (this.write === this.read) this.read = null;
    return ret;
  }

  /**
   * Get the item at the top of the buffer, but don't remove it
   * @return {any}
   */
  peek() {
    if (this.read === null) return null;
    return this.array[this.read];
  }
}

/** Provides a stream.Readable interface to the connection classes */
class ConnectionReadStreamWrap extends stream.Readable {
  /**
   * The constructor
   * @param {ClientConnection|ServerConnection} connection Connection to wrap
   * @param {Number} [bufferLength=64] How large the buffer should be
   */
  constructor(connection, bufferLength = 64) {
    super({ objectMode: true, highWaterMark: bufferLength });
    this.connection = connection;
    this.lock = false;
  }

  /** Node.js Readable _read method */
  async _read() {
    if (this.lock) return; // there is already a read operation happening
    this.lock = true;
    for (;;) {
      let data;
      try {
        data = await this.connection.readMessage();
      } catch (err) {
        process.nextTick(() => this.emit('error', err));
        return;
      }
      if (!data) this.push(null);
      if (!this.push(data)) break;
    }
    this.lock = false;
  }
}

module.exports = {
  CircularBuffer,
  ConnectionReadStreamWrap,
  errCode
};
