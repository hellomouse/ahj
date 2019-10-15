declare module "srp-bigint" {
  const params: {
    [key: number]: {
      N_length_bits: number,
      N: BigInt
      g: BigInt
      hash: string
    }
  }

  const param: typeof params

  class Client {
    constructor(params: typeof param, saltBuf: Buffer, identityBuf: Buffer, passwordBuf: Buffer, secret1Buf: Buffer)
    computeA(): any
    setB(arg0: Buffer): any
    computeK(): Buffer
  }
  class Server {
    constructor(params: typeof param, verifierBuf: Buffer, secret2Buf: Buffer)
    setA(ABuf: Buffer): void
    computeB(): any
    computeK(): Buffer
  }
  export {
    Client,
    Server,
    params
  }
}