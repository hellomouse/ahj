/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
/** @enum {symbol} */
const ConnectionModes = {
  INIT: Symbol('INIT'),
  RESUME: Symbol('RESUME')
};
/** @enum {symbol} */
const ConnectionStates = {
  INIT: Symbol('INIT'),
  DISCONNECTED: Symbol('DISCONNECTED'),
  CONNECTED: Symbol('CONNECTED'),
  HANDSHAKING: Symbol('HANDSHAKING'),
  CONNECTING: Symbol('CONNECTING')
};
/** @enum {symbol} */
const ChannelStates = {
  OPENING: Symbol('OPENING'),
  OPEN: Symbol('OPEN'),
  CLOSING: Symbol('CLOSING'),
  CLOSED: Symbol('CLOSED')
};
/** @enum {number} */
const ClientHandshake = {
  INIT: 0,
  RESUME: 1
};
ClientHandshake[exports.ConnectionModes.INIT] = ClientHandshake['INIT'];
ClientHandshake[exports.ConnectionModes.RESUME] = ClientHandshake['RESUME'];
/** @enum {number} */
const ServerHandshake = {
  OK: 0,
  INVALID_SESSION: 1,
  INVALID_IDENTITY: 2
};
/** @enum {number} */
const SessionControl = {
  CHANNEL_OPEN: 0,
  CHANNEL_OPEN_ACK: 1,
  CHANNEL_OPEN_NAK: 2,
  CHANNEL_CLOSE: 3,
  CHANNEL_CLOSE_ACK: 4,
  CHANNEL_MESSAGE: 5,
  CONNECTION_CLOSE_REMOTE: 6
};

exports.ConnectionModes = ConnectionModes;
exports.ConnectionStates = ConnectionStates;
exports.ChannelStates = ChannelStates;
exports.ClientHandshake = ClientHandshake;
exports.ServerHandshake = ServerHandshake;
exports.SessionControl = SessionControl;
