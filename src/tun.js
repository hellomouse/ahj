const { Duplex } = require('stream');
const { read, write } = require('fs');

/** Creates a Duplex stream from a file descriptor */
class FDReader extends Duplex {
    /**
     * The constructor
     * @param {Number} fd The file descriptor
     * @param {Object} options Options for underlying Duplex
     */
    constructor(fd, options) {
        super(options);
        this.fd = fd;
    }
    /**
     * Reads from the FD and pushes to internal buffer
     * @param {Number} size
     */
    _read(size) {
        read()
    }
}

module.exports = FDReader;
