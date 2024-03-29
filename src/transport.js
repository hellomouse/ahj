/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
const EventEmitter = require('events');
// const debug = require('debug')('ahj:transport');

/** @typedef {import('./connection.js')} Connection */
/** @typedef {import('./client.js')} Client */
/** @typedef {import('./server.js')} Server */

/** Represents a Transport */
class Transport extends EventEmitter {
  constructor() {
    super();
    /**
     * Set of every connection associated with the Transport, even those that
     * may not be completely connected yet
     * @type {Set<Connection>}
     */
    this.connections = new Set();
  }
}

/** Represents a Transport for use on the client */
class ClientTransport extends Transport {
  constructor() {

  }
}

/** Represents a Transport for use on the server */
class ServerTransport extends Transport {

}

exports.Transport = Transport;
exports.ClientTransport = ClientTransport;
exports.ServerTransport = ServerTransport;
