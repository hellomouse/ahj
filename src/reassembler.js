/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Fragment = require('./fragment.js');
const stream = require('stream');

let debug;
if (process.env.DEBUG) debug = require('debug')('ahj:reassembler');
else debug = () => {};

/** Represents a message of several fragments */
class PartialMessage {
  /**
   * The constructor
   * @param {number} id Message identifier
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
   * @return {boolean} True if finished, false if not yet
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
   * @param {number} [bufferLength=32] Length of internal buffer
   */
  constructor(bufferLength = 32) {
    super({ objectMode: true, highWaterMark: bufferLength });
    /** @type {PartialMessage[]} */
    this.fragmentCache = [];
  }

  /**
   * Process new data
   * @param {Buffer} data
   * @param {string} _encoding Not used
   * @param {Function} callback
   */
  _transform(data, _encoding, callback) {
    let fragments = Fragment.fromMany(data);
    for (let fragment of fragments) {
      let partial = this.fragmentCache[fragment.id];
      if (!partial) {
        debug(`processing new fragment ${fragment.id}`);
        partial = this.fragmentCache[fragment.id] =
          new PartialMessage(fragment.id);
      } else debug(`processing continuation of fragment ${fragment.id}`);
      partial.processNewFragment(fragment);
      if (partial.finished) {
        debug(`fragment ${fragment.id} done`);
        this.fragmentCache[fragment.id] = null;
        this.push(partial.reassembled);
      }
    }
    callback(null);
  }
}

module.exports = {
  PartialMessage,
  Reassembler
};
