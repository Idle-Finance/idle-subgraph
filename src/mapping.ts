import { BigInt, Address, ethereum, store, log } from "@graphprotocol/graph-ts"

import { ADDRESS_ZERO, TOKEN_MAPPING } from "./helpers"

import {
  Transfer as TransferEvent
} from "../generated/idleDAIBestYield/IdleTokenGovernance"
import { User, Token, UserToken } from "../generated/schema"

function getOrCreateUser(userAddress: Address, block: ethereum.Block): User {
  let userId = userAddress.toHex()
  let user = User.load(userId)
  if (user==null) {
    user = new User(userId)

    user.firstInteractionTimestamp = block.timestamp
    user.save()
  }
  return user as User
}

function getOrCreateToken(tokenAddress: Address): Token {
  let tokenId = tokenAddress.toHex()
  let token = Token.load(tokenId)
  if (token==null) {
    token = new Token(tokenId)

    token.address = tokenAddress
    
    let tokenName = "Default"
    if (TOKEN_MAPPING.has(tokenAddress.toHexString())) {
      tokenName = TOKEN_MAPPING.get(tokenAddress.toHexString())
    }
    else {
      log.warning("Token {} does not exist in mapping", [tokenAddress.toHexString()])
    }
    
    token.name = tokenName

    token.save()
  }
  return token as Token
}

function getOrCreateUserToken(user: User, token: Token): UserToken {
  let userTokenId = user.id.toString()
    .concat("-")
    .concat(token.id.toString())

  let userToken = UserToken.load(userTokenId)
  if (userToken == null) {
    userToken = new UserToken(userTokenId)

    userToken.user = user.id
    userToken.token = token.id
    userToken.balance = BigInt.fromI32(0)

    userToken.save()
  }

  return userToken as UserToken
}

function handleMint(event: TransferEvent): void {
  let user = getOrCreateUser(event.params.to, event.block)
  let token = getOrCreateToken(event.address)

  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance + event.params.value;
  userToken.save()
}

function handleBurn(event: TransferEvent): void {
  let user = getOrCreateUser(event.params.from, event.block)
  let token = getOrCreateToken(event.address)

  // would be faster to create new instance, and overwrite existing userToken
  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance - event.params.value;
  userToken.save()
}

function handleTokenTransfer(event: TransferEvent): void {

}

export function handleTransfer(event: TransferEvent): void {
  if (event.params.from.toHexString() == ADDRESS_ZERO) {
    log.info("Mint Detected", [])
    handleMint(event)
  }
  else if (event.params.to.toHexString() == ADDRESS_ZERO) {
    log.info("Burn Detected", [])
    handleBurn(event)
  }
  else {
    log.info("Transfer Detected", [])
    handleTokenTransfer(event)
  }
}

// export function handleAdminChanged(event: AdminChanged): void {
//   // Entities can be loaded from the store using a string ID; this ID
//   // needs to be unique across all entities of the same type
//   let entity = ExampleEntity.load(event.transaction.from.toHex())

//   // Entities only exist after they have been saved to the store;
//   // `null` checks allow to create entities on demand
//   if (entity == null) {
//     entity = new ExampleEntity(event.transaction.from.toHex())

//     // Entity fields can be set using simple assignments
//     entity.count = BigInt.fromI32(0)
//   }

//   // BigInt and BigDecimal math are supported
//   entity.count = entity.count + BigInt.fromI32(1)

//   // Entity fields can be set based on event parameters
//   entity.previousAdmin = event.params.previousAdmin
//   entity.newAdmin = event.params.newAdmin

//   // Entities can be written to the store with `.save()`
//   entity.save()

//   // Note: If a handler doesn't require existing field values, it is faster
//   // _not_ to load the entity from the store. Instead, create it fresh with
//   // `new Entity(...)`, set the fields that should be updated and save the
//   // entity back to the store. Fields that were not set or unset remain
//   // unchanged, allowing for partial updates to be applied.

//   // It is also possible to access smart contracts from mappings. For
//   // example, the contract that has emitted the event can be connected to
//   // with:
//   //
//   // let contract = Contract.bind(event.address)
//   //
//   // The following functions can then be called on this contract to access
//   // state variables and other data:
//   //
//   // - contract.implementation(...)
//   // - contract.admin(...)
// }

// export function handleUpgraded(event: Upgraded): void {}
