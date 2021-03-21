import { Address } from "@graphprotocol/graph-ts"


export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

let TOKEN_MAPPING = new Map<string,string>()

// Note, the addresses need to be lowercase

// Mainnet mappings
TOKEN_MAPPING.set("0x3fe7940616e5bc47b0775a0dccf6237893353bb4", "idleDAIBestYield")
TOKEN_MAPPING.set("0x5274891bec421b39d23760c04a6755ecb444797c", "idleUSDCBestYield")
TOKEN_MAPPING.set("0xf34842d05a1c888ca02769a633df37177415c2f8", "idleUSDTBestYield")
TOKEN_MAPPING.set("0xf52cdcd458bf455aed77751743180ec4a595fd3f", "idleSUSDBestYield")
TOKEN_MAPPING.set("0xc278041fdd8249fe4c1aad1193876857eea3d68c", "idleTUSDBestYield")
TOKEN_MAPPING.set("0x8c81121b15197fa0eeaee1dc75533419dcfd3151", "idleWBTCBestYield")

export { TOKEN_MAPPING }