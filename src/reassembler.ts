/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import Fragment from './fragment';
import stream from 'stream';

import dbg from 'debug';
let debug: dbg.Debugger | (() => void);
if (process.env.DEBUG) {
  debug = dbg('ahj:disassembler');
} else debug = () => {};

/** Represents a message of several fragments */
class PartialMessage {
  id: number;
  fragments: any[];
  hasLastFragment: boolean;
  currentFragments: number;
  totalFragments: any;
  finished: boolean;
  reassembled: any;
  /**
   * The constructor
   * @param {number} id Message identifier
   */
  constructor(id: number) {
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
  processNewFragment(fragment: Fragment): boolean {
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
  fragmentCache: any[];
  /**
   * The constructor
   * @param {number} [bufferLength=32] Length of internal buffer
   */
  constructor(bufferLength: number = 32) {
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
  _transform(data: Buffer, _encoding: string, callback: Function) {
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

export {
  PartialMessage,
  Reassembler
};
