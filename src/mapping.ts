import { BigInt, Address, ethereum, store, log } from "@graphprotocol/graph-ts"

import { ADDRESS_ZERO, ONE_BI, ZERO_BI, exponentToBigInt } from "./helpers"
import { getOrCreateUser, getOrCreateToken, getOrCreateUserToken, getOrCreateReferrer, getOrCreateReferrerToken } from "./getters"

import {
  Transfer as TransferEvent,
  Referral as ReferralEvent,
  IdleTokenGovernance
} from "../generated/idleDAIBestYield/IdleTokenGovernance"
import { erc20 } from "../generated/idleDAIBestYield/erc20"
import { User, Token, UserToken, Referrer, ReferrerToken } from "../generated/schema"

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

  // process fee
  let contract = IdleTokenGovernance.bind(token.address as Address)
  let userAveragePrice = contract.userAvgPrices(user.address as Address) // this is expressed in underlying decimals

  let tokenDecimals = token.decimals as BigInt // this is in token decimals
  let tokenToUnderlyingDenom = exponentToBigInt(tokenDecimals)

  let tokenBalance = userToken.balance as BigInt

  let profit = tokenBalance * (token.lastPrice - userAveragePrice) / tokenToUnderlyingDenom // to convert decimals from idle token to underlying
  let fee = (profit * token.fee) / BigInt.fromI32(100000)

  userToken.totalProfitRedeemed = userToken.totalProfitRedeemed + profit
  userToken.totalFeePaidInUnderlying = userToken.totalFeePaidInUnderlying + fee
  userToken.balance = userToken.balance - event.params.value
  userToken.save()

  token.totalSupply = token.totalSupply - event.params.value
  token.totalFeePaidInUnderlying = token.totalFeePaidInUnderlying + fee
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
  let idleTokenDecimals = token.decimals as BigInt
  
  let decimalsForToken = exponentToBigInt(idleTokenDecimals)
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
  // The growth needs to be calculated using the previous fee value
  // therefore the fee is set after the previous steps
  token.fee = contract.fee()

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
