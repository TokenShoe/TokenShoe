/**
 * Vesting: claimable amount calculation (ported line by line from TokenVesting._unlockedAmount / _claimableFromSchedule),
 * so the frontend can show "claimable now" without calling the contract.
 */
export interface ScheduleLike {
  totalAmount: bigint
  claimed: bigint
  tgeTime: number
  tgeBps: number
  cliffDuration: number
  vestingDuration: number
  interval: number
  revoked: boolean
  revokedClaimableCap: bigint
}

export function unlockedAmount(s: ScheduleLike, now: number): bigint {
  const total = s.totalAmount
  const tgeAmount = (total * BigInt(s.tgeBps)) / 10_000n
  const postTge = total - tgeAmount
  const cliffEnd = s.tgeTime + s.cliffDuration
  const vestEnd = cliffEnd + s.vestingDuration

  let unlocked: bigint
  if (now < s.tgeTime) unlocked = 0n
  else if (now < cliffEnd) unlocked = tgeAmount
  else if (s.vestingDuration === 0) unlocked = total
  else if (s.interval === 0) unlocked = tgeAmount + (postTge * BigInt(now - cliffEnd)) / BigInt(s.vestingDuration)
  else {
    const elapsed = Math.floor((now - cliffEnd) / s.interval) * s.interval
    unlocked = tgeAmount + (postTge * BigInt(elapsed)) / BigInt(s.vestingDuration)
  }
  if (now >= vestEnd) unlocked = total
  return unlocked > total ? total : unlocked
}

export function claimableAmount(s: ScheduleLike, now: number): bigint {
  if (s.revoked) return s.revokedClaimableCap > s.claimed ? s.revokedClaimableCap - s.claimed : 0n
  const unlocked = unlockedAmount(s, now)
  return unlocked > s.claimed ? unlocked - s.claimed : 0n
}
