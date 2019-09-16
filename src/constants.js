module.exports = {
  clientHandshake: {
    INIT: 0,
    RESUME: 1
  },
  serverHandshake: {
    OK: 0,
    INVALID_SESSION: 1,
    INVALID_IDENTITY: 2
  },
  messageTypes: {
    DATA: 0,
    CHANNEL_OPEN: 1,
    CHANNEL_OPEN_ACK: 2,
    CHANNEL_CLOSE: 3,
    CHANNEL_CLOSE_ACK: 4,
    CHANNEL_MESSAGE: 5
  }
};
