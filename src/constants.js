module.exports = {
  ConnectionModes: {
    INIT: Symbol('INIT'),
    RESUME: Symbol('RESUME')
  },
  ConnectionStates: {
    DISCONNECTED: Symbol('DISCONNECTED'),
    CONNECTED: Symbol('CONNECTED'),
    HANDSHAKING: Symbol('HANDSHAKING'),
    CONNECTING: Symbol('CONNECTING')
  },
  ClientHandshake: {
    INIT: 0,
    RESUME: 1
  },
  ServerHandshake: {
    OK: 0,
    INVALID_SESSION: 1,
    INVALID_IDENTITY: 2
  },
  MessageTypes: {
    CHANNEL_OPEN: 1,
    CHANNEL_OPEN_ACK: 2,
    CHANNEL_CLOSE: 3,
    CHANNEL_CLOSE_ACK: 4,
    CHANNEL_MESSAGE: 5
  }
};

exports.ClientHandshake[exports.ConnectionModes.INIT] = exports.ConnectionModes['INIT'];
exports.ClientHandshake[exports.ConnectionModes.RESUME] = exports.ConnectionModes['RESUME'];
