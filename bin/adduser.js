const fs = require('fs');
const fsP = fs.promises;
const read = require('read');
const util = require('util');
const readAsync = util.promisify(read);

/**
 * Generates client configuration files and adds credentials to the
 * server configuration file.
 * Usage: node bin/adduser.js [<server config>] [<username>] [<salt>] [<verifier>]
 */
async function main() {
  let configPath = process.argv[2] || 'serverconfig.json';
  let identity = process.argv[3] || await readAsync({
    prompt: 'Username:'
  });
  let salt = Buffer.from(process.argv[4] || await readAsync({
    prompt: 'Salt:'
  }), 'base64');
  if (!salt.length) throw new Error('Invalid salt!');
  let verifier = Buffer.from(process.argv[5] || await readAsync({
    prompt: 'Verifier:'
  }), 'base64');
  if (!verifier.length) throw new Error('Invalid verifier!');
  let serverConfig = await fsP.readFile(configPath);
  serverConfig = JSON.parse(serverConfig.toString());
  serverConfig.clients[identity] = verifier.toString('base64');
  await fsP.writeFile(configPath, JSON.stringify(serverConfig, null, 4));
  let clientConfig = {
    handshakeKey: serverConfig.handshakeKey,
    host: serverConfig.host,
    port: serverConfig.port,
    username: identity,
    salt: salt.toString('base64'),
    password: '<REPLACE WITH ACTUAL PASSWORD>'
  };
  console.log(JSON.stringify(clientConfig, null, 4));
}

main();
