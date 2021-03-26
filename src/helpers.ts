import { Address, BigInt } from "@graphprotocol/graph-ts"

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)

export function exponentToBigInt(decimals: BigInt): BigInt {
    let bi = BigInt.fromI32(1)
    for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
      bi = bi.times(BigInt.fromI32(10))
    }
    return bi
  }
