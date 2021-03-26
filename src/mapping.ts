import { BigInt, Address, ethereum, store, log } from "@graphprotocol/graph-ts"

import { ADDRESS_ZERO, ONE_BI, ZERO_BI, exponentToBigInt } from "./helpers"

import {
  Transfer as TransferEvent,
  Referral as ReferralEvent,
  IdleTokenGovernance
} from "../generated/idleDAIBestYield/IdleTokenGovernance"
import { erc20 } from "../generated/idleDAIBestYield/erc20"
import { User, Token, UserToken, Referrer, ReferrerToken } from "../generated/schema"

function getOrCreateUser(userAddress: Address, block: ethereum.Block): User {
  let userId = userAddress.toHex()
  let user = User.load(userId)
  if (user==null) {
    user = new User(userId)

    user.address = userAddress
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

    let contract = IdleTokenGovernance.bind(tokenAddress)
    let underlyingTokenAddress = contract.token()

    let underlyingToken = erc20.bind(underlyingTokenAddress)
    
    token.name = contract.name()
    token.decimals = BigInt.fromI32(contract.decimals())
    
    token.underlyingTokenAddress = underlyingTokenAddress
    token.underlyingTokenName = underlyingToken.name()
    token.underlyingTokenDecimals = BigInt.fromI32(underlyingToken.decimals())

    token.lastPrice = exponentToBigInt(token.underlyingTokenDecimals as BigInt)
    token.lastPriceTimestamp = ZERO_BI

    token.totalSupply = ZERO_BI
    token.uniqueUserCount = ZERO_BI

    token.fee = contract.fee()
    token.totalFeeGeneratedInUnderlying = ZERO_BI

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
    userToken.balance = ZERO_BI

    userToken.save()

    token.uniqueUserCount = token.uniqueUserCount + ONE_BI
    token.save()
  }

  return userToken as UserToken
}

function getOrCreateReferrer(referrerAddress: Address): Referrer {
  let referrerId = referrerAddress.toHex()
  let referrer = Referrer.load(referrerId)

  if (referrer == null) {
    referrer = new Referrer(referrerId)

    referrer.address = referrerAddress
    referrer.totalReferralCount = ZERO_BI

    referrer.save()
  }

  return referrer as Referrer
}

function getOrCreateReferrerToken(referrer: Referrer, token: Token): ReferrerToken {
  let referrerTokenId = referrer.id.toString()
    .concat("-")
    .concat(token.id.toString())

  let referrerToken = ReferrerToken.load(referrerTokenId)
  if (referrerToken == null) {
    referrerToken = new ReferrerToken(referrerTokenId)

    referrerToken.referrer = referrer.id
    referrerToken.token = token.id
    referrerToken.referralCount = ZERO_BI
    referrerToken.referralTotal = ZERO_BI

    referrerToken.save()
  }

  return referrerToken as ReferrerToken
}

function handleMint(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let user = getOrCreateUser(event.params.to, event.block)

  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance + event.params.value
  userToken.save()

  token.totalSupply = token.totalSupply + event.params.value
  token.save()
}

function handleRedeem(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let user = getOrCreateUser(event.params.from, event.block)

  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance - event.params.value;
  userToken.save()

  token.totalSupply = token.totalSupply - event.params.value
  token.save()
}

function handleTokenTransfer(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let userFrom = getOrCreateUser(event.params.from, event.block)
  let userTo = getOrCreateUser(event.params.to, event.block)

  let userTokenFrom = getOrCreateUserToken(userFrom, token)
  let userTokenTo = getOrCreateUserToken(userTo, token)

  userTokenFrom.balance = userTokenFrom.balance - event.params.value
  userTokenTo.balance = userTokenTo.balance + event.params.value

  userTokenFrom.save()  
  userTokenTo.save()  
}

export function handleTransfer(event: TransferEvent): void {
  let contract = IdleTokenGovernance.bind(event.address)
  let currentTokenPrice = contract.tokenPrice()

  let token = getOrCreateToken(event.address)

  // calculate token generated fee

  if (currentTokenPrice < token.lastPrice) {
    log.warning("Token seems to have decreased in value. CurrentPrice: {}, lastPrice: {}", [currentTokenPrice.toString(), token.lastPrice.toString()])
    currentTokenPrice = token.lastPrice
  }

  // The underlying AUM as expressed in underlying decimals can be expressed as
  //
  // Example
  // idleTokenDecimals = 18
  // underlyingTokenDecimals = 8
  //
  // NOTE: totalSupply is expressed in idleTokenDecimals
  //       tokenPrice is expressed in underlyingTokenDecimals
  //
  // AUM = totalSupply * tokenPrice / (10^idleTokenDecimals * 10^(idleTokenDecimals-underlyingTokenDecimals))
  let idleTokenDecimals = token.decimals as BigInt
  let underlyingTokenDecimals = token.underlyingTokenDecimals as BigInt
  let exponentForUnderlying = idleTokenDecimals + (idleTokenDecimals - idleTokenDecimals)
  
  let decimalsForToken = exponentToBigInt(exponentForUnderlying)
  let underlyingAUM = (token.totalSupply * token.lastPrice) / decimalsForToken  // this is the underlying AUM expressed in decimals for the underlying token

  log.debug("Last token price: {}. Current token price: {}", [token.lastPrice.toString(), currentTokenPrice.toString()])
  let growth = ((underlyingAUM * currentTokenPrice) / token.lastPrice) - underlyingAUM
  log.debug("Growth of pool {} was {}", [token.name, growth.toString()])
  let generatedFee = (growth *  token.fee) / BigInt.fromI32(100000)
  
  // update token
  token.totalFeeGeneratedInUnderlying = token.totalFeeGeneratedInUnderlying + generatedFee
  token.lastPrice = currentTokenPrice
  token.lastPriceTimestamp = event.block.timestamp

  // add handler for fee change
  // token.fee = contract.fee()

  token.save()
  
  if (event.params.from.toHexString() == ADDRESS_ZERO) {
    log.info("Mint Detected", [])
    handleMint(event)
  }
  else if (event.params.to.toHexString() == ADDRESS_ZERO) {
    log.info("Redeem Detected", [])
    handleRedeem(event)
  }
  else {
    log.info("Transfer Detected", [])
    handleTokenTransfer(event)
  }
}

export function handleReferral(event: ReferralEvent): void {
  let token = getOrCreateToken(event.address)
  let referrer = getOrCreateReferrer(event.params._ref)

  let referrerToken = getOrCreateReferrerToken(referrer, token)

  referrer.totalReferralCount = referrer.totalReferralCount + ONE_BI
  referrer.save()

  referrerToken.referralCount = referrerToken.referralCount + ONE_BI
  referrerToken.referralTotal = referrerToken.referralTotal + event.params._amount

  referrerToken.save()
}
