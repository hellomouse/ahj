# ahj - American Headset Jack, or whatever you want to call it, really

This is a weird obfuscated network protocol that was originally meant to be part
of a VPN. It was designed with the existence of advanced DPI in mind and is
meant to be as difficult to identify as possible.

## The name makes no sense

Yep. It was a sequence of 3 random letters and something completely irrelevant.

## How to use

Documentation will be made soon. For now, see jsdoc.

For examples, see test/client.js and test/server.js.

To generate configuration:

1. `bin/generate-config.js <host> <port>` to generate server configuration  
The output should be saved to `serverconfig.json` or a similarly named file

2. `bin/generate-verifier.js` to generate salt and verifier  
The verifier will be used by the server to authenticate clients

3. `bin/adduser.js` to add client to server configuration and to generate
a configuration template for the client  
If a path to the server configuration is not given as the first argument,
`serverconfig.json` will be used

## WIP documentation

### Protocol features

* Complete encryption of the protocol using AEAD, including the handshake
* Authentication and support of multiple users via SRP
* N:M multiplexing of connections, where any number of connections can occur
  over any non-zero amount of carrier connections
* Carrier connections can be opened or closed at any time as long as one
  connection remains to hold the session open
* Length randomization, where the length of messages sent over the wire are
  independent from the length of messages on top of the protocol except for
  approximate closeness
* Out-of-order delivery, where messages are likely to be delivered out of order
  but are reassembled at the endpoint
* Message-oriented, and therefore able to transfer message-based protocols such
  as UDP without additional wrapping

### Why not shadowsocks?

Shadowsocks seems to be the most popular censorship circumvention tool currently
in use. However, it has one major issue: each "real" connection corresponds to
one proxied connection. This could potentially result in:

* Fingerprinting by connection patterns  
A DPI firewall may be able to classify traffic as using shadowsocks if it can
recognize specific patterns in connections. For example, if several
short-lived connections happen to the same port and all receive substantially
more data than they send, the DPI system may conclude HTTP traffic is being
sent over shadowsocks.
* Fingerprinting by diversity  
If a DPI system observes several short-lived connections but one long-lived
connection to the same port which in contrast sends very little data, the DPI
may conclude such traffic is HTTP mixed with websockets, and identify such
traffic as belonging to shadowsocks.
* Fingerprinting by data patterns  
A DPI system may be able to recognize specific protocols running over
shadowsocks by observing the patterns of which data is sent between the client
and server. For example, if a connection is opened, several small messages are
exchanged (TLS handshake then HTTP request), then the server sends a large
amount of data to the client, and then the connection is closed, the DPI may
be able to recognize a TLS connection occuring within a tunnel.

This project aims to lessen these problems by completely decoupling underlying
connections from connections happening over the protocol. One HTTP request may
end up being split across 2 connections, or perhaps combined with other
requests, or both. Persistent connections (such as websockets or ordinary TCP)
may end up having been sent over a large number of seemingly independent
connections. The carrier connections themselves could be short-lived or kept
open for a long time, or a mixture of both.
