const { Server } = require('../src/server.js');
const fsP = require('fs').promises;
const repl = require('repl');

/** Main function */
async function main() {
  let config = await fsP.readFile(process.argv[2] || './serverconfig.json');
  config = JSON.parse(config.toString());
  config.handshakeKey = Buffer.from(config.handshakeKey, 'base64');
  for (let [identity, verifier] of Object.entries(config.clients)) {
    config.clients[identity] = Buffer.from(verifier, 'base64');
  }

  let server = new Server(config);
  server.listen();

  let cli = repl.start();
  cli.context.server = server;
}

main();
