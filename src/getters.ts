import { BigInt, Address, ethereum } from "@graphprotocol/graph-ts"

import { ONE_BI, ZERO_BI, exponentToBigInt } from "./helpers"

import { User, Token, UserToken, Referrer, ReferrerToken } from "../generated/schema"
import { erc20 } from "../generated/idleDAIBestYield/erc20"
import { IdleTokenGovernance } from "../generated/idleDAIBestYield/IdleTokenGovernance"

export function getOrCreateUser(userAddress: Address, block: ethereum.Block): User {
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
  
export function getOrCreateToken(tokenAddress: Address): Token {
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
    token.totalFeePaidInUnderlying = ZERO_BI

    token.totalRebalances = ZERO_BI

    token.save()
  }
  return token as Token
}
  
export function getOrCreateUserToken(user: User, token: Token): UserToken {
  let userTokenId = user.id.toString()
    .concat("-")
    .concat(token.id.toString())

  let userToken = UserToken.load(userTokenId)
  if (userToken == null) {
    userToken = new UserToken(userTokenId)

    userToken.user = user.id
    userToken.token = token.id
    userToken.balance = ZERO_BI

    userToken.totalFeePaidInUnderlying = ZERO_BI
    userToken.totalProfitRedeemed = ZERO_BI

    userToken.save()

    token.uniqueUserCount = token.uniqueUserCount + ONE_BI
    token.save()
  }

  return userToken as UserToken
}
  
export function getOrCreateReferrer(referrerAddress: Address): Referrer {
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

export function getOrCreateReferrerToken(referrer: Referrer, token: Token): ReferrerToken {
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