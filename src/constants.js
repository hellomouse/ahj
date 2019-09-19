exports = module.exports = {
  ConnectionModes: {
    INIT: Symbol('INIT'),
    RESUME: Symbol('RESUME')
  },
  ConnectionStates: {
    INIT: Symbol('INIT'),
    DISCONNECTED: Symbol('DISCONNECTED'),
    CONNECTED: Symbol('CONNECTED'),
    HANDSHAKING: Symbol('HANDSHAKING'),
    CONNECTING: Symbol('CONNECTING')
  },
  ChannelStates: {
    OPENING: Symbol('OPENING'),
    OPEN: Symbol('OPEN'),
    CLOSING: Symbol('CLOSING'),
    CLOSED: Symbol('CLOSED')
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
  ChannelControl: {
    CHANNEL_OPEN: 0,
    CHANNEL_OPEN_ACK: 1,
    CHANNEL_OPEN_NAK: 2,
    CHANNEL_CLOSE: 3,
    CHANNEL_CLOSE_ACK: 4,
    CHANNEL_MESSAGE: 5
  }
};

exports.ClientHandshake[exports.ConnectionModes.INIT] = exports.ClientHandshake['INIT'];
exports.ClientHandshake[exports.ConnectionModes.RESUME] = exports.ClientHandshake['RESUME'];
