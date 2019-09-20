const constants = require('./constants.js');
const stream = require('stream');
const { Deferred, errCode } = require('./utils.js');
const util = require('util');
const sleep = util.promisify(setTimeout);
const debug = require('debug')('ahj:channels');

const ChannelStates = constants.ChannelStates;
const ChannelControl = constants.ChannelControl;

/** @typedef {import('./session.js')} Session */

/** Represents a data channel */
class Channel extends stream.Duplex {
  /**
   * The constructor
   * @param {object} opts
   * @param {number} opts.id Channel identifier
   * @param {ChannelHandler} opts.channelHandler Associated handler
   */
  constructor(opts) {
    super({ objectMode: true });
    this.id = opts.id;
    this.idBuf = Buffer.allocUnsafe(2);
    this.idBuf.writeUInt16BE(this.id, 0);
    this.handler = opts.channelHandler;
    this.session = this.handler.session;
    this.state = ChannelStates.OPENING;
    /**
     * Current sequence number (local -> remote)
     * NOTE: Sequence numbers start at and wrap back around to 1, sequence
     * number 0 represents a control message
     */
    this.localSequence = 1;
    /** Current sequence number (remote -> local) */
    this.remoteSequence = 1;

    /**
     * True when we have already received remote close and are now waiting for
     * the last message
     */
    this._remoteCloseWait = false;
    /**
     * Last sequence number of remote -> local stream (plus one)
     * Used to determine when the channel has ended
     * @type {number}
     */
    this._lastRemoteSequence = null;
    /**
     * Holds the Deferred instance for waiting for the completion of what is
     * currently in progress (opening/closing)
     * @type {Deferred}
     */
    this._operationWait = null;
    /** Sparse array for holding out of order pieces */
    this._outOfOrderCache = new Array(65536);
    /** If readable part should accept new data */
    this._shouldPush = true;
  }

  /**
   * Change state of channel
   * @param {symbol} state New state
   */
  setState(state) {
    debug(`channel ${this.id} state change ${this.state.description} => ${state.description}`);
    this.state = state;
    this.emit('stateChange', state);
  }

  /** Node.js stream.Readable _read method */
  _read() {
    this._shouldPush = true;
    this.emit('canPush');
  }

  /**
   * Process a new message
   * @param {number} sequence Sequence number
   * @param {Buffer} data Data to process
   * @return {boolean}
   */
  _processMessage(sequence, data) {
    let ret = true;
    if (sequence === this.remoteSequence) {
      ret = this.push(data);
      while (true) {
        let next = ++this.remoteSequence;
        if (next > 65535) next = this.remoteSequence = 1;
        let thing = this._outOfOrderCache[next];
        if (!thing) break;
        ret = this.push(thing);
        delete this._outOfOrderCache[next];
      }
      if (
        this._remoteCloseWait &&
        (this._lastRemoteSequence === this.remoteSequence)
      ) this._operationWait.resolve();
    } else {
      if (this._outOfOrderCache[sequence]) {
        // this should not happen
        throw errCode(
          `Channel ${this.id} out of order cache overflowed, expect dropped messages`,
          'CHANNEL_OUT_OF_ORDER_QUEUE_OVERFLOWED'
        );
      }
      this._outOfOrderCache[sequence] = data;
    }
    if (!ret) this._shouldPush = false;
    return ret;
  }

  /**
   * Node.js stream.Writable _write method
   * @param {Buffer} chunk
   * @param {string} _encoding Unused
   * @param {Function} callback
   */
  _write(chunk, _encoding, callback) {
    if (this.state !== ChannelStates.OPEN) {
      throw errCode('Channel is not open!', 'CHANNEL_NOT_OPEN');
    }
    let sequenceBuf = Buffer.allocUnsafe(2);
    sequenceBuf.writeUInt16BE(this.localSequence);
    let message = Buffer.concat([
      this.idBuf,
      sequenceBuf,
      chunk
    ]);
    this.localSequence++;
    if (this.localSequence > 65535) this.localSequence = 1;
    let doneCb = () => {
      this.handler.push(message);
      callback();
    };
    if (this.handler._shouldPush) doneCb();
    else this.handler.once('canPush', doneCb);
  }

  /**
   * Send an out-of-band message across the channel
   * No backpressuring is considered when sending out-of-band messages
   * @param {Buffer} data
   */
  sendOobMessage(data) {
    if (this.state !== ChannelStates.OPEN) {
      throw errCode('Channel is not open!', 'CHANNEL_NOT_OPEN');
    }
    this.handler.push(Buffer.concat([
      this.idBuf,
      Buffer.from([0, 0, ChannelControl.CHANNEL_MESSAGE]),
      data
    ]));
  }

  /** Close this channel */
  close() {
    if (this.state !== ChannelStates.OPEN) return; // no need to do anything
    this.handler._doChannelClose(this);
  }
}

/** Handles messages and splits them to channels */
class ChannelHandler extends stream.Duplex {
  /**
   * The constructor
   * @param {object} opts
   * @param {Session} opts.session Associated session
   */
  constructor(opts) {
    super({ objectMode: true });
    /** @type {Map<number, Channel>} */
    this.channels = new Map();
    this.session = opts.session;
    this._lastChannelId = 0;
    this._shouldPush = true;
  }

  /**
   * Get next available channel id
   * @return {number}
   */
  _getNextChannelId() {
    let ret;
    do {
      ret = this._lastChannelId++;
      if (ret > 65535) {
        this._lastChannelId = 1;
        ret = 0;
      }
    } while (this.channels.has(ret));
    return ret;
  }

  /**
   * Create a new channel
   * @return {Channel}
   */
  async createChannel() {
    if (this.channels.size >= 65536) {
      throw errCode('Too many open channels!', 'TOO_MANY_CHANNELS');
    }
    let id = this._getNextChannelId();
    let channel = new Channel({
      id,
      channelHandler: this
    });
    channel._operationWait = new Deferred();
    this.channels.set(id, channel);
    let message = Buffer.concat([
      channel.idBuf,
      Buffer.from([
        0, 0, // sequence number 0, control message
        ChannelControl.CHANNEL_OPEN
      ])
    ]);
    debug(`sending channel open message for channel ${id}`);
    this.push(message);
    // eslint pls
    /* eslint-disable require-atomic-updates */
    while (true) {
      try {
        await channel._operationWait.promise;
        // open was acknowledged
        debug(`remote acknowleged channel open for ${id}`);
        channel.setState(ChannelStates.OPEN);
        channel._operationWait = null;
        process.nextTick(() => {
          this.emit('localOpenedChannel', channel);
          this.emit('channelOpened', channel);
        });
        return channel;
      } catch (err) {
        // remote end sent CHANNEL_OPEN_NAK, try again in a bit
        debug(`remote rejected channel open for ${id}`);
        await sleep(10); // totally arbitrary number
        let id = this._getNextChannelId();
        debug(`retrying channel open with new id ${id}`);
        this.channels.delete(channel.id);
        this.channels.set(id, channel);
        channel.id = id;
        channel.idBuf.writeUInt16BE(id);
        let message = Buffer.concat([
          channel.idBuf,
          Buffer.from([0, 0, ChannelControl.CHANNEL_OPEN])
        ]);
        channel._operationWait = new Deferred();
        this.push(message);
      }
    }
    /* eslint-enable require-atomic-updates */
  }

  /** Node.js stream.Readable _read method */
  _read() {
    this._shouldPush = true;
    // inform waiting streams that downstream is no longer backlogged
    this.emit('canPush');
  }

  /**
   * Node.js stream.Writable _write method
   * @param {Buffer} chunk
   * @param {string} _encoding Unused
   * @param {Function} callback
   * @return {undefined}
   */
  _write(chunk, _encoding, callback) {
    if (chunk.length < 4) return callback(); // wat
    let channelId = chunk.readUInt16BE(0);
    let sequence = chunk.readUInt16BE(2);
    let rest = chunk.slice(4);

    if (sequence === 0) {
      // control message
      switch (rest[0]) {
        case ChannelControl.CHANNEL_OPEN: {
          debug(`received CHANNEL_OPEN for ${channelId}`);
          if (this.channels.has(channelId)) {
            debug(`... but that channel already exists`);
            this.push(Buffer.concat([
              chunk.slice(0, 4), // laziness
              Buffer.from([ChannelControl.CHANNEL_OPEN_NAK])
            ]));
          } else {
            debug(`... creating new channel`);
            let channel = new Channel({
              id: channelId,
              channelHandler: this
            });
            channel.setState(ChannelStates.OPEN);
            this.channels.set(channelId, channel);
            this.push(Buffer.concat([
              chunk.slice(0, 4), // laziness
              Buffer.from([ChannelControl.CHANNEL_OPEN_ACK])
            ]));
            this.emit('remoteOpenedChannel', channel);
            this.emit('channelOpened', channel);
          }
          break;
        }
        case ChannelControl.CHANNEL_OPEN_ACK: {
          debug(`received CHANNEL_OPEN_ACK for ${channelId}`);
          let channel = this.channels.get(channelId);
          if (!channel) {
            debug(`... but that channel doesn't exist?`);
            break;
          }
          channel._operationWait.resolve();
          break;
        }
        case ChannelControl.CHANNEL_OPEN_NAK: {
          debug(`received CHANNEL_OPEN_NAK for ${channelId}`);
          let channel = this.channels.get(channelId);
          if (!channel) {
            debug(`... but that channel doesn't exist?`);
            break;
          }
          channel._operationWait.reject();
          break;
        }
        case ChannelControl.CHANNEL_CLOSE: {
          // FIXME: attach last sequence number to CLOSE and CLOSE_ACK to prevent
          // errors and data loss
          debug(`received CHANNEL_CLOSE for ${channelId}`);
          let channel = this.channels.get(channelId);
          if (!channel) {
            debug(`... but that channel doesn't exist?`);
            break;
          }
          // prevent further data from being sent
          channel.setState(ChannelStates.CLOSING);
          channel.emit('remoteClose');
          if (!channel.writableEnded) channel.end();
          (async () => {
            let finalSequence = rest.readUInt16BE(1);
            if (channel.remoteSequence !== finalSequence) {
              // final remote message hasn't been received yet
              debug(`channel ${channel.id} waiting for last message ${finalSequence}`);
              channel._operationWait = new Deferred();
              channel._remoteCloseWait = true;
              channel._lastRemoteSequence = finalSequence;
              await channel._operationWait.promise;
              debug(`channel ${channel.id} received last message`);
            }
            // close down readable part
            channel.push(null);
            // wait for any possible remaining data to be sent
            // CLOSE message should be received after remaining data is sent
            let finishCb = () => {
              channel.setState(ChannelStates.CLOSED);
              this.channels.delete(channel.id);
              debug(`channel ${channel.id} sending channel close acknowledge`);
              debug(`... last sequence: ${channel.localSequence}`);
              let message = Buffer.concat([
                chunk.slice(0, 4),
                Buffer.from([ChannelControl.CHANNEL_CLOSE_ACK, 0, 0])
              ]);
              message.writeUInt16BE(channel.localSequence, 5);
              this.push(message);
            };
            if (channel.writableFinished) finishCb();
            else channel.on('finish', finishCb);
          })();
          break;
        }
        case ChannelControl.CHANNEL_CLOSE_ACK: {
          debug(`received CHANNEL_CLOSE_ACK for ${channelId}`);
          let channel = this.channels.get(channelId);
          if (!channel) {
            debug(`... but that channel doesn't exist?`);
            break;
          }
          if (channel.state !== ChannelStates.CLOSING) {
            debug(`... but that channel isn't in state CLOSING?`);
            break;
          }
          // extra paranoia
          if (!channel.writableFinished) {
            debug(`... but that channel doesn't seem to have been closed in the first place?`);
            // possible severe desync
            this.emit('error', errCode(
              `Unexpected CHANNEL_CLOSE_ACK message for channel ${channelId}`,
              'UNEXPECTED_CHANNEL_CLOSE_ACK'
            ));
            break;
          }
          (async () => {
            let finalSequence = rest.readUInt16BE(1);
            if (channel.remoteSequence !== finalSequence) {
              debug(`channel ${channel.id} waiting for last message ${finalSequence}`);
              channel._operationWait = new Deferred();
              channel._remoteCloseWait = true;
              channel._lastRemoteSequence = finalSequence;
              await channel._operationWait.promise;
              debug(`channel ${channel.id} received last message`);
            }
            channel.push(null);
            channel.setState(ChannelStates.CLOSED);
            this.channels.delete(channelId);
          })();
          break;
        }
        case ChannelControl.CHANNEL_MESSAGE: {
          debug(`received CHANNEL_MESSAGE for ${channelId}`);
          let channel = this.channels.get(channelId);
          if (!channel) {
            debug(`... but that channel doesn't exist?`);
            break;
          }
          channel.emit('oobMessage', rest.slice(1));
          break;
        }
      }
      callback();
    } else {
      let channel = this.channels.get(channelId);
      if (!channel) {
        callback();
        return debug(`Received message for nonexistent channel ${channelId}`);
      }
      let pushCb = () => {
        channel._processMessage(sequence, rest);
        callback();
      };
      if (!channel._shouldPush) {
        channel.once('canPush', pushCb);
      } else pushCb();
    }
  }

  /**
   * Internal method to handle sending channel close message
   * @param {Channel} channel
   */
  _doChannelClose(channel) {
    channel.setState(ChannelStates.CLOSING);
    if (!channel.writableEnded) channel.end();
    let finishCb = () => {
      debug(`channel ${channel.id} sending close message`);
      debug(`... last sequence: ${channel.localSequence}`);
      let message = Buffer.concat([
        channel.idBuf,
        Buffer.from([0, 0, ChannelControl.CHANNEL_CLOSE, 0, 0])
      ]);
      message.writeUInt16BE(channel.localSequence, 5);
      this.push(message);
    };
    if (!channel.writableFinished) channel.on('finish', finishCb);
    else finishCb();
  }

  /**
   * Push new data to be sent
   * Overrides stream push method
   * @param {Buffer} data
   * @return {boolean}
   */
  push(data) {
    let result = super.push(data);
    if (!result) this._shouldPush = false;
    return result;
  }
}

module.exports = {
  Channel,
  ChannelHandler
};
