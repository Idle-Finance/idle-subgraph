import { BigInt, Address, ethereum, store, log, ByteArray, Bytes } from "@graphprotocol/graph-ts"

import { ADDRESS_ZERO, ONE_BI, ZERO_BI, exponentToBigInt } from "./helpers"
import {
  getOrCreateUser,
  getOrCreateToken,
  getOrCreateUserToken,
  getOrCreateReferrer, 
  getOrCreateReferrerToken,
  getOrCreateReferrerUserToken,
  getReferrerUserToken,
  getOrCreateStats
} from "./getters"

import {
  Transfer as TransferEvent,
  Referral as ReferralEvent,
  Rebalance as RebalanceEvent,
  IdleTokenGovernance
} from "../generated/idleDAIBestYield/IdleTokenGovernance"
import { erc20 } from "../generated/idleDAIBestYield/erc20"
import { User, Token, UserToken, Redeem, Mint, Transfer, Referrer, ReferrerToken, Rebalance, Referral } from "../generated/schema"

function handleMint(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let user = getOrCreateUser(event.params.to, event.block)

  let userToken = getOrCreateUserToken(user, token)

  userToken.balance = userToken.balance + event.params.value
  userToken.save()

  token.totalSupply = token.totalSupply + event.params.value
  token.save()

  let mintId = event.transaction.hash.toHex().concat('-').concat(event.logIndex.toString())
  let mint = new Mint(mintId)
  mint.tx = event.transaction.hash
  mint.token = token.id
  mint.user = user.id
  mint.amount = event.params.value
  mint.blockHeight = event.block.number

  mint.save()

  let s = getOrCreateStats()
  s.totalMints = s.totalMints + ONE_BI
  s.save()
}

function handleRedeem(event: TransferEvent): void {
  let token = getOrCreateToken(event.address)
  let user = getOrCreateUser(event.params.from, event.block)

  let userToken = getOrCreateUserToken(user, token)
  let referrerUserToken = getReferrerUserToken(user, token)

  // process fee
  let contract = IdleTokenGovernance.bind(token.address as Address)
  let userAveragePrice = contract.userAvgPrices(user.address as Address) // this is expressed in underlying decimals

  let tokenDecimals = token.decimals as BigInt // this is in token decimals
  let tokenToUnderlyingDenom = exponentToBigInt(tokenDecimals)

  let profit = event.params.value * (token.lastPrice - userAveragePrice) / tokenToUnderlyingDenom // to convert decimals from idle token to underlying
  let fee = (profit * token.fee) / BigInt.fromI32(100000)

  userToken.totalProfitRedeemed = userToken.totalProfitRedeemed + profit
  userToken.totalFeePaidInUnderlying = userToken.totalFeePaidInUnderlying + fee
  userToken.balance = userToken.balance - event.params.value
  userToken.save()

  token.totalSupply = token.totalSupply - event.params.value
  token.totalFeePaidInUnderlying = token.totalFeePaidInUnderlying + fee
  token.save()

  let redeemId = event.transaction.hash.toHex().concat('-').concat(event.logIndex.toString())
  let redeem = new Redeem(redeemId)
  redeem.tx = event.transaction.hash
  redeem.token = token.id
  redeem.user = user.id
  redeem.amount = event.params.value
  redeem.feeInUnderlying = fee
  redeem.blockHeight = event.block.number

  redeem.save()

  // handle referrers
  if (referrerUserToken != null) {
    let referrer = Referrer.load(referrerUserToken.referrer) as Referrer
    let referrerToken = getOrCreateReferrerToken(referrer, token)

    let diff = event.params.value // in idle token
    if (diff > referrerUserToken.balance) {
      diff = referrerUserToken.balance
    }

    referrerUserToken.balance = referrerUserToken.balance - diff
    referrerToken.totalBalance = referrerToken.totalBalance - diff

    let referrerProfit = diff * (token.lastPrice - userAveragePrice) / tokenToUnderlyingDenom
    referrerToken.totalProfitEarnedInUnderlying = referrerToken.totalProfitEarnedInUnderlying + referrerProfit

    referrerUserToken.save()
    referrerToken.save()
  }

  let s = getOrCreateStats()
  s.totalRedeems = s.totalRedeems + ONE_BI
  s.save()

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
  
  let transferId = event.transaction.hash.toHex().concat('-').concat(event.logIndex.toString())
  let transfer = new Transfer(transferId)
  transfer.tx = event.transaction.hash
  transfer.token = token.id
  transfer.userFrom = userTokenFrom.id
  transfer.userTo = userTokenTo.id
  transfer.amount = event.params.value
  transfer.blockHeight = event.block.number

  transfer.save()
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
  let underlyingTokenDecimals = token.underlyingTokenDecimals as BigInt
  
  let decimalsForToken = exponentToBigInt(idleTokenDecimals)
  let decimalsForUnderlyingToken = exponentToBigInt(underlyingTokenDecimals)
  let underlyingAUM = (token.totalSupply * token.lastPrice) / decimalsForToken // this is the underlying AUM expressed in decimals for the underlying token

  log.debug("Last token price: {}. Current token price: {}", [token.lastPrice.toString(), currentTokenPrice.toString()])
  let growth = underlyingAUM * (currentTokenPrice - token.lastPrice) / decimalsForUnderlyingToken // Expressed in underlying
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

  let txHash = event.transaction.hash
  let logId = event.logIndex - BigInt.fromI32(1)
  let mint = null as Mint | null
  
  // handle case if multiple referrals on the same tx
  while (logId > ZERO_BI) {
    mint = Mint.load(txHash.toHex().concat('-').concat(logId.toString()))
    if (mint != null) {break}
  }

  referrer.totalReferralCount = referrer.totalReferralCount + ONE_BI

  referrerToken.referralCount = referrerToken.referralCount + ONE_BI
  referrerToken.totalBalance = referrerToken.totalBalance + mint.amount

  referrerToken.save()

  let referral = new Referral(txHash.toHex().concat('-').concat(event.logIndex.toString()))
  referral.tx = txHash
  if (mint != null) {
    referral.mint = mint.id
    referral.user = mint.user
    referral.token = mint.token
  } else {
    log.error("Could not find mint for referral. tx: {}", [txHash.toHex()])
  }

  let referrerUserToken = getOrCreateReferrerUserToken(
    referrer,
    User.load(referral.user) as User,
    Token.load(referral.token) as Token
  )

  referrerUserToken.balance = referrerUserToken.balance + mint.amount // in IDLE tokens
  referrerUserToken.save()

  referral.referredTokenAmountInUnderlying = event.params._amount
  referral.referrer = referrer.id
  referral.blockHeight = event.block.number
  referral.save()

  let s = getOrCreateStats()
  s.totalReferrals = s.totalReferrals + ONE_BI
  s.save()
}

export function handleRebalance(event: RebalanceEvent): void {
  let token = getOrCreateToken(event.address)

  let rebalanceId = event.transaction.hash.toHex().concat('-').concat(event.logIndex.toString())
  let rebalance = new Rebalance(rebalanceId)

  let tokenContract = IdleTokenGovernance.bind(event.address)
  
  let tokenAllocations = new Array<BigInt>()
  let lendingTokens = new Array<Bytes>()

  let index = BigInt.fromI32(0)
  while (true) {
    let lastAllocationCall = tokenContract.try_lastAllocations(index)
    if (lastAllocationCall.reverted) {break}

    let lendingToken = tokenContract.allAvailableTokens(index) as Address

    tokenAllocations.push(lastAllocationCall.value)
    lendingTokens.push(lendingToken)

    index = index + ONE_BI
  }

  rebalance.allocation = tokenAllocations
  rebalance.lendingTokens = lendingTokens

  rebalance.token = token.id
  rebalance.amountRebalances = event.params._amount
  rebalance.blockHeight = event.block.number

  rebalance.save()

  token.totalRebalances = token.totalRebalances + ONE_BI
  token.save()

  let s = getOrCreateStats()
  s.totalRebalances = s.totalRebalances + ONE_BI
  s.save()
}
