/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Represents a Fragment (a part of a message) */
class Fragment {
  id: number;
  index: number;
  isLast: boolean;
  data: Buffer;
  length: number;
  /**
   * The constructor
   * @param {number} id Fragment identifier (0-255)
   * @param {number} index Fragment index (0-255)
   * @param {boolean} isLast Whether or not this fragment is the last
   * @param {Buffer} data Data
   */
  constructor(id: number, index: number, isLast: boolean, data: Buffer) {
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
  toBuffer(): Buffer {
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
  static fromBuffer(buf: Buffer): Fragment {
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
  static fromMany(buf: Buffer): Fragment[] {
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

export default Fragment;
