const { Client } = require('../src/client.js');
const fsP = require('fs').promises;
const repl = require('repl');

/** Main function */
async function main() {
  let config = await fsP.readFile(process.argv[2] || './clientconfig.json');
  config = JSON.parse(config.toString());
  config.handshakeKey = Buffer.from(config.handshakeKey, 'base64');
  config.identity = Buffer.from(config.identity);
  config.salt = Buffer.from(config.salt, 'base64');
  config.password = Buffer.from(config.password);

  let client = new Client(config);
  await client.connect();

  let cli = repl.start();
  cli.context.client = client;
}

main();
