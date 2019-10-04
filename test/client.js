/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

  cli.context.doSshTunnel = function doSshTunnel() {
    const net = require('net');
    const debug = require('debug')('ahj:sshproxy-client');
    setInterval(() => client.session.disassembler.tick());
    let server = cli.context.sshListener = net.createServer(async socket => {
      debug('got connection, creating channel...');
      let channel = await client.session.createChannel();
      debug(`channel created (${channel.id}), connecting`);
      socket.pipe(channel).pipe(socket);
      socket.on('close', () => {
        debug(`closing down channel ${channel.id}`);
        channel.close();
      });
    });
    server.listen(22222, () => debug('server listening'));
  };
}

main();
