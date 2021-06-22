# TODO

* Turn `stuff.js` into actual tests
  * actual test framework too
* SOCKS interface
  * put it in another package
* Use workers to do crypto and other expensive operations faster
  * spawn one thread per connection perhaps
  * find out how much overhead passing messages between workers has
* Make benchmarks to test performance maybe
* A proper configuration reader
* Allow building custom transports
  * for example, tls or websockets
* Allow different strategies for individual components
  * for example, custom allocators for the disassembler
  * ability to change random source
* Somehow do ticking of disassembler properly or just replace it entirely
  with something less weird
* Allow one endpoint to ask the other to close the connection
  * if it is only ever the client that closes all of the connections, suspicions
    may be raised
* Allow different AEAD ciphers to be used
* Actual documentation
* Rename things with names that actually make sense
* TypeScript definitely
* Update eslint configuration
* Acknowledgement stuff because broken connections are not very reliable
  * Figure out how to do this with minimal overhead
  * Possibly do this on the session layer, on top of disassembler
* become laughingstock on HN or something
* does this even work in its intended purpose
  * get someone from china to see if it works
* be better at writing code
* get arrested by chinese internet police or something
  * also literally never going to happen because this project sucks
