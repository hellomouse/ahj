// DEMO AND RANDOM CODE
const crypto = require('crypto');
const stream = require('stream');
const srp = require('srp-bigint');
const {
  StreamConsumer,
  aeadEncrypt,
  aeadDecryptNext
} = require('./protocol.js');
const Client = require('./client.js');
const Server = require('./server.js');
const SRP_PARAMS = srp.params[2048];

/**
 * Read n bytes from a stream
 * NOT WORKING
 * @param {Stream} stream
 */
/*
async function* streamConsumer(stream) {
  let wantedSize = yield;
  let chunks = [];
  let satisfiedSize = 0;
  for await (let chunk of stream) {
    chunks.push(chunk);
    satisfiedSize += chunk.length;
    while (satisfiedSize >= wantedSize) {
      let out = Buffer.concat(chunks);
      chunks = [];
      if (out.length > wantedSize) {
        chunks.push(out.slice(wantedSize));
        out = out.slice(0, wantedSize);
      }
      satisfiedSize = satisfiedSize - wantedSize;
      wantedSize = yield out;
    }
  }
}
*/

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
let clientConnection = new Client.ClientConnection({
  host: 'localhost',
  port,
  mode: 'INIT',
  handshakeKey,
  salt,
  identity: identityBuf,
  password
});
let connections = [];
let num = 1;
server.on('newConnection', conn => {
  let connectionNum = num++;
  connections.push(conn);
  conn.on('connected', async () => {
    for (;;) {
      let message = await conn.readMessage();
      console.log(`client => server (${connectionNum}): ${message.toString()}`);
    }
  });
});
(async () => {
  await clientConnection.connect();
  console.log('connected');
  (async () => {
    let clientConnection2 = new Client.ClientConnection({
      host: 'localhost',
      port,
      mode: 'RESUME',
      sessionId: clientConnection.sessionId,
      handshakeKey,
      salt,
      identity: identityBuf,
      password
    });
    await clientConnection2.connect();
    cli.context.clientConnection2 = clientConnection2;
    for (;;) {
      let message = await clientConnection2.readMessage();
      console.log('server => client (2):', message.toString());
    }
  })();
  for (;;) {
    let message = await clientConnection.readMessage();
    console.log('server => client (1):', message.toString());
  }
})();
cli.context.connections = connections;
cli.context.server = server;
cli.context.clientConnection = clientConnection;
