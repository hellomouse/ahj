/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
const { ErrorCode } = require('./utils.js');
const crypto = require('crypto');

/** @typedef {import('stream').Stream} Stream */

/** Read n bytes from a stream */
class StreamConsumer {
  /**
   * The constructor
   * @param {Stream} stream The stream to read bytes from
   */
  constructor(stream) {
    this.stream = stream;
    this.iterator = this.stream[Symbol.asyncIterator]();
    this.chunks = [];
    this.currentLength = 0;
    this.locked = false;
  }
  /**
   * Read the next chunk from the stream and add it to the buffer
   * @return {Promise<Buffer>} The chunk that was read
   */
  async readNextChunk() {
    let next = await this.iterator.next();
    if (next.done) {
      throw new ErrorCode('Stream is closed', 'STREAM_CLOSED');
    }
    let chunk = next.value;
    this.currentLength += chunk.length;
    this.chunks.push(chunk);
    return chunk;
  }
  /**
   * Get length bytes from the stream
   * @param {number} wantedSize
   * @return {Promise<Buffer>}
   */
  async read(wantedSize) {
    if (this.locked) {
      throw new ErrorCode('An operation is still in progress', 'STREAM_LOCKED');
    }
    this.locked = true;
    while (true) {
      if (this.currentLength >= wantedSize) {
        let out = Buffer.concat(this.chunks);
        this.chunks = [];
        if (out.length > wantedSize) {
          this.chunks.push(out.slice(wantedSize));
          out = out.slice(0, wantedSize);
        }
        this.currentLength = this.currentLength - wantedSize;
        this.locked = false;
        return out;
      } else await this.readNextChunk();
    }
  }
  /**
   * Read from the stream until specified character is found
   * @param {number} char
   * @return {Promise<Buffer>} What was read, including the specified character
   */
  async readToChar(char) {
    if (this.locked) {
      throw new ErrorCode('An operation is still in progress', 'STREAM_LOCKED');
    }
    this.locked = true;
    // there should only be one item in chunks or fewer when we start
    let chunk = this.chunks[0] || await this.readNextChunk();
    while (true) {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === char) {
          // last chunk is in chunk variable already
          let buffered = Buffer.concat(this.chunks.slice(0, -1));
          this.chunks = [];
          if (i !== chunk.length - 1) {
            this.chunks.push(chunk.slice(i + 1));
            chunk = chunk.slice(0, i + 1);
          }
          this.locked = false;
          return Buffer.concat([buffered, chunk]);
        }
      }
      chunk = await this.readNextChunk();
    }
  }
}

/**
 * Encrypt message using chacha20-poly1395
 * @param {Buffer} key
 * @param {Buffer} nonce
 * @param {Buffer} message
 * @return {Buffer}
 */
function aeadEncrypt(key, nonce, message) {
  // @ts-ignore ChaCha20-Poly1305 is a valid cipher
  let cipher = crypto.createCipheriv(
    'ChaCha20-Poly1305', key, nonce, { authTagLength: 16 }
  );
  let lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(message.length, 0);
  return Buffer.concat([
    cipher.update(lenBuf),
    cipher.update(message),
    cipher.final(),
    cipher.getAuthTag()
  ]);
}

/**
 * Decrpyt a message from a stream encrypted with chacha20-poly1305
 * @param {Buffer} key
 * @param {Buffer} nonce
 * @param {StreamConsumer} consumer
 * @return {Promise<Buffer>}
 */
async function aeadDecryptNext(key, nonce, consumer) {
  // @ts-ignore
  let decipher = crypto.createDecipheriv(
    'ChaCha20-Poly1305', key, nonce, { authTagLength: 16 }
  );
  // read and decrypt length bytes
  // @ts-ignore
  let length = decipher.update(await consumer.read(2)).readUInt16BE();
  // read and decrypt message
  // @ts-ignore
  let out = decipher.update(await consumer.read(length));
  // @ts-ignore
  decipher.setAuthTag(await consumer.read(16));
  try {
    decipher.final();
  } catch (err) {
    throw new ErrorCode('Unable to authenticate data', 'AUTHENTICATION_FAILED');
  }
  return out;
}

exports.StreamConsumer = StreamConsumer;
exports.aeadEncrypt = aeadEncrypt;
exports.aeadDecryptNext = aeadDecryptNext;
