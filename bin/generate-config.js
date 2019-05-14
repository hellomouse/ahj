const crypto = require('crypto');

/**
 * Generates a server configuration file
 * Usage: node bin/generate-config.js <hostname> <port>
 */
async function main() {
  let handshakeKey = crypto.randomBytes(32).toString('base64');
  let host = process.argv[2];
  let port = +process.argv[3];
  let config = {
    handshakeKey,
    host,
    port,
    clients: {}
  };
  console.log(JSON.stringify(config, null, 4));
}

main();
