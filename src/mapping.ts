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

  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance - event.params.value;
  userToken.save()
}

function handleTokenTransfer(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let userFrom = getOrCreateUser(event.params.from, event.block)
  let userTo = getOrCreateUser(event.params.to, event.block)

  let userTokenFrom = getOrCreateUserToken(userFrom, token)
  let userTokenTo = getOrCreateUserToken(userTo, token)

  userTokenFrom.balance = userTokenFrom - event.params.value;
  userTokenTo.balance = userTokenTo + event.params.value;

  userTokenFrom.save()  
  userTokenTo.save()  
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
