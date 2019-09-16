// DEMO AND RANDOM CODE
const crypto = require('crypto');
const util = require('util');
const stream = require('stream');
const srp = require('srp-bigint');
const {
  StreamConsumer,
  aeadEncrypt,
  aeadDecryptNext
} = require('../src/protocol.js');
const {
  Client,
  ClientConnection
} = require('../src/client.js');
const {
  Server,
  Session,
  ServerConnection
} = require('../src/server.js');
const { Disassembler } = require('../src/disassembler.js');
const { Reassembler } = require('../src/reassembler.js');
const SRP_PARAMS = srp.params[2048];

/**
 * Print errors
 * @param {Error} err
 */
function errorHandler(err) {
  console.log(err);
  console.log(err.code);
}
process.on('uncaughtException', errorHandler);
process.on('unhandledRejection', errorHandler);

/**
 * Stream consumer demo
 * not quite 4 bytes
 *  stream1.write('asd');
 *  stream1.write('f');
 * exactly 4 bytes
 *  stream1.write('asdf');
 * over 4 bytes
 *  stream1.write('asdfg');
 *  stream1.write('hjk');
 * even more over 4 bytes
 *  stream1.write('asdfghjk');
 */
let cli = require('repl').start();
cli.context.StreamConsumer = StreamConsumer;
let stream1 = new stream.PassThrough();
let consumer1 = new StreamConsumer(stream1);
(async () => {
  for (;;) console.log((await consumer1.read(4)).toString());
})();
cli.context.stream1 = stream1;
cli.context.consumer = consumer1;

/**
 * AEAD demo
 * first, write nonce to stream
 *  let nonce = crypto.randomBytes(12);
 *  stream2.write(nonce);
 * then, write encrypted content
 *  stream2.write(aeadEncrypt(key, nonce, Buffer.from('Hello, world!')));
 */
let stream2 = new stream.PassThrough();
let consumer2 = new StreamConsumer(stream2);
cli.context.stream2 = stream2;
cli.context.consumer2 = consumer2;
cli.context.aeadEncrypt = aeadEncrypt;
cli.context.aeadDecryptNext = aeadDecryptNext;

let key = cli.context.key = crypto.randomBytes(32);
(async () => {
  for (;;) {
    let nonce = await consumer2.read(12);
    console.log('got nonce', nonce);
    let message = await aeadDecryptNext(key, nonce, consumer2);
    console.log('got message:', message.toString());
  }
})();

/**
 * Protocol demo
 */
let handshakeKey = crypto.randomBytes(32);
let port = 35872;
let salt = crypto.randomBytes(16);
let identity = 'iczero';
let identityBuf = Buffer.from(identity);
let password = crypto.randomBytes(43);
let verifier = srp.computeVerifier(SRP_PARAMS, salt, identityBuf, password);
let server = new Server({
  handshakeKey,
  port,
  clients: { [identity]: verifier }
});
server.listen();
let client = new Client({
  host: 'localhost',
  port,
  handshakeKey,
  salt,
  identity: identityBuf,
  password
});
server.on('newSession', session => {
  cli.context.session = session;
  let reassembler = new Reassembler();
  session.readStream.pipe(reassembler)
    .on('data', d => console.log('client => server', d.toString()));
});
cli.context.clientDisassembler = new Disassembler(client.connections);
(async () => {
  await client.connect();
  await client.addConnection();
  await client.addConnection();
  await client.addConnection();
})();

cli.context.server = server;
cli.context.client = client;
