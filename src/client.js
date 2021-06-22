/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @ts-check
const EventEmitter = require('events');
const debug = require('debug')('ahj:client');
// createSession(sessionId)
/* Outline
constructor(opts: ClientOptions)
  ClientOptions.transport: ClientTransport
    the transport to be used, or the default one
  ClientOptions.transportOptions: TransportOptions
    transport-specific options, for example username/password and such
  ClientOptions.strategy: Strategy
    the "strategy" to be used
  ClientOptions.disassemblerOptions: DisassemblerOptions
    disassembler-specific configuration options
  ClientOptions.reassemblerOptions: ReassemblerOptions
    reassembler-specific configuration options
attachSession(sessionId: Buffer) -> Session
  creates a new session with the given sessionId, sets it as the session
  belonging to the Client, and returns it
connect()
  calls ClientTransport#doInitialConnect
close()
  calls Session#close
transport: associated Transport object
session: associated Session object
*/
/** Represents a Client */
class Client extends EventEmitter {
  
}

module.exports = Client;
