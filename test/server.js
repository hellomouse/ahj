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

  cli.context.doSshTunnel = function doSshTunnel() {
    const net = require('net');
    const debug = require('debug')('ahj:sshproxy-server');
    server.on('newSession', session => {
      let tickTimer = setInterval(() => session.disassembler.tick());
      session.on('end', () => clearInterval(tickTimer));
      debug(`new session: ${session.sessionIdN}`);
      session.on('remoteOpenedChannel', channel => {
        debug(`new channel: ${channel.id}`);
        let socket = net.createConnection(22, 'localhost', () => {
          debug(`connected to server, piping`);
          socket.pipe(channel).pipe(socket);
        });
        socket.on('close', () => {
          debug(`closing down channel ${channel.id}`);
          channel.close();
        });
        socket.on('error', error => {
          debug(`socket error ${error.code}, closing down channel ${channel.id}`);
          channel.close();
        });
      });
    });
  };
}

main();
