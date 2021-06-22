/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
// random useful stuff
const stream = require('stream');

/** @typedef {import('./connection.js')} Connection */

/** An Error object with a code property */
class ErrorCode extends Error {
  /**
   * The constructor
   * @param {string} message Error message
   * @param {string} code Error code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// eslint-plugin-jsdoc doesn't support @template
/* eslint-disable jsdoc/no-undefined-types */
/**
 * Circular buffer implementation
 * @template T
 */
class CircularBuffer {
  /**
   * The constructor
   * @param {number} size How large the buffer should be
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
   * @return {boolean}
   */
  isFull() {
    return this.write === null;
  }

  /**
   * Whether or not the buffer is empty
   * @return {boolean}
   */
  isEmpty() {
    return this.read === null;
  }

  /**
   * Add an item to the buffer
   * @param {T} item
   * @return {boolean} True if added, false if full
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
   * @return {T} The item, or null if the buffer is empty
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
   * @return {T}
   */
  peek() {
    if (this.read === null) return null;
    return this.array[this.read];
  }
}
/* eslint-enable jsdoc/no-undefined-types */

/** Provides a stream.Readable interface to the connection classes */
class ConnectionReadStreamWrap extends stream.Readable {
  /**
   * The constructor
   * @param {Connection} connection Connection to wrap
   * @param {number} [bufferLength=64] How large the buffer should be
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
    while (true) {
      let data;
      try {
        data = await this.connection.readMessage();
      } catch (err) {
        process.nextTick(() => this.emit('error', err));
        return;
      }
      if (!data) {
        this.push(null);
        break;
      }
      if (!this.push(data)) break;
    }
    this.lock = false;
  }
}

/** Implements a Deferred */
class Deferred {
  /** The constructor */
  constructor() {
    /** @type {Function} */
    this.resolve = null;
    /** @type {Function} */
    this.reject = null;
    /** @type {Promise} */
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

exports.CircularBuffer = CircularBuffer;
exports.ConnectionReadStreamWrap = ConnectionReadStreamWrap;
exports.Deferred = Deferred;
exports.ErrorCode = ErrorCode;
