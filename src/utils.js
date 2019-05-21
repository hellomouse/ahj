// random useful stuff

/**
 * Create a new Error with a code
 * @param {String} message Error message
 * @param {String} code Error code
 * @return {Error}
 */
function errCode(message, code) {
  let error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  errCode
};
