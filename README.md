# ahj - American Headset Jack

This is a weird obfuscated network protocol that was originally meant to be part
of a VPN.

## The name makes no sense

Yep.

## How to use

Documentation will be made soon. For now, see jsdoc.

For examples, see test/client.js and test/server.js.

To generate configuration:

1. `bin/generate-config.js <host> <port>` to generate server configuration
2. `bin/generate-verifier.js` to generate salt and verifier
3. `bin/adduser.js` to add client to server configuration and to generate
a configuration template for the client
