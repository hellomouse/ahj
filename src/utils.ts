/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// random useful stuff
import stream = require('stream');
import client = require('./client');
import server = require('./server');
/** @typedef {import('./client.js').ClientConnection} ClientConnection */
/** @typedef {import('./server.js').ServerConnection} ServerConnection */

interface CustomError extends Error {
  code: string
}

/**
 * Create a new Error with a code
 * @param {string} message Error message
 * @param {string} code Error code
 * @return {Error}
 */
function errCode(message: string, code: string) {
  let error = new Error(message);
  (error as CustomError).code = code;
  return error;
}

/** Circular buffer implementation */
class CircularBuffer {
  size: number;
  array: any[];
  count: number;
  read: any;
  write: number;
  /**
   * The constructor
   * @param {number} size How large the buffer should be
   */
  constructor(size: number) {
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
  isFull(): boolean {
    return this.write === null;
  }

  /**
   * Whether or not the buffer is empty
   * @return {boolean}
   */
  isEmpty(): boolean {
    return this.read === null;
  }

  /**
   * Add an item to the buffer
   * @param {any} item
   * @return {boolean} True if added, false if full
   */
  push(item: any): boolean {
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
  pop(): any {
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
  peek(): any {
    if (this.read === null) return null;
    return this.array[this.read];
  }
}

/** Provides a stream.Readable interface to the connection classes */
class ConnectionReadStreamWrap extends stream.Readable {
  connection: client.ClientConnection;
  lock: boolean;
  /**
   * The constructor
   * @param {ClientConnection|ServerConnection} connection Connection to wrap
   * @param {number} [bufferLength=64] How large the buffer should be
   */
  constructor(connection: client.ClientConnection | server.ServerConnection, bufferLength: number = 64) {
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
  resolve: any;
  reject: any;
  promise: Promise<unknown>;
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

export = {
  CircularBuffer,
  ConnectionReadStreamWrap,
  Deferred,
  errCode
};
