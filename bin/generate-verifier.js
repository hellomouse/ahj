const srp = require('srp-bigint');
const crypto = require('crypto');
const util = require('util');
const read = require('read');
const readAsync = util.promisify(read);

/**
 * Generates necessary information to create account
 * Usage: node bin/generate-verifier.js [<username>] [<password>]
 * If username or password are not provided, they will be prompted for
 * on the console.
 */
async function main() {
  let params = srp.params[2048];
  let salt = crypto.randomBytes(16);
  let identity = Buffer.from(process.argv[2] || await readAsync({
    prompt: 'Username:'
  }));
  if (identity.length > 255) {
    throw new Error('Username must be less than 256 characters long');
  }
  let password = Buffer.from(process.argv[3] || await readAsync({
    prompt: 'Password:',
    silent: true
  }));
  let verifier = srp.computeVerifier(params, salt, identity, password);
  console.log('Salt: ' + salt.toString('base64'));
  console.log('Verifier: ' + verifier.toString('base64'));
}

main();
