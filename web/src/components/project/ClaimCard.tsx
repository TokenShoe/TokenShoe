'use client'
/**
 * A card showing "how much can I claim in this project" + a claim button. Claiming works differently per type:
 *   merkle  -> fetch proof -> claim(index, account, amount, proof)
 *   sign    -> ask the backend to sign -> claim(account, amount, claimId, deadline, sig)
 *   vesting -> claim(ids of schedules with something claimable)
 * After a successful claim, useChainTx syncs the backend and refreshes the data automatically.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { Check } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Data'
import { Notice } from '@/components/ui/Feedback'
import { TypeBadge, StatusBadge, Amount } from './Bits'
import { useChainTx, listPending, removePending, syncTx } from '@/hooks/useChainTx'
import { api, ApiClientError } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/errors'
import { formatDateTime, formatDuration, percent, relativeTime } from '@/lib/client/format'
import { MERKLE_WRITE_ABI, SIGN_WRITE_ABI, VESTING_WRITE_ABI } from '@/lib/abis'
import type { EligibilityDTO, ScheduleDTO } from '@/lib/client/types'

export function ClaimCard({ item, showProject = true }: { item: EligibilityDTO; showProject?: boolean }) {
  const { address } = useAccount()
  const { send } = useChainTx()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = item.project
  const sym = p.tokenSymbol
  const claimable = BigInt(item.claimable)
  const fullyClaimed = BigInt(item.allocated) > 0n && BigInt(item.claimed) >= BigInt(item.allocated)

  async function claim() {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      if (p.type === 'merkle') {
        const proof = await api<{ index: number; amount: string; proof: `0x${string}`[] }>(`/api/projects/${p.address}/merkle-proof?account=${address}`)
        await send({
          label: `Claim ${sym ?? 'tokens'}`,
          request: { address: p.address, abi: MERKLE_WRITE_ABI, functionName: 'claim', args: [BigInt(proof.index), address, BigInt(proof.amount), proof.proof] },
        })
      } else if (p.type === 'sign') {
        const sig = await requestSignature(p.address, address)
        await send({
          label: `Claim ${sym ?? 'tokens'}`,
          request: {
            address: p.address, abi: SIGN_WRITE_ABI, functionName: 'claim',
            args: [address, BigInt(sig.amount), sig.claimId, BigInt(sig.deadline), sig.signature],
          },
        })
      } else {
        const ids = (item.schedules ?? []).filter((x) => BigInt(x.claimable) > 0n).map((x) => BigInt(x.scheduleId))
        await send({ label: `Claim ${sym ?? 'tokens'}`, request: { address: p.address, abi: VESTING_WRITE_ABI, functionName: 'claim', args: [ids] } })
      }
    } catch (e) {
      // Wallet errors were already shown as a toast by useChainTx; only show API errors here
      if (e instanceof ApiClientError) setError(e.message)
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        {showProject && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Link href={`/projects/${p.address}`} className="font-medium text-ink hover:underline truncate block">{p.name}</Link>
              <div className="flex items-center gap-2 flex-wrap"><TypeBadge type={p.type} /><StatusBadge status={p.status} /></div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Allocated"><Amount wei={item.allocated} decimals={p.tokenDecimals} symbol={sym} /></Figure>
          <Figure label="Claimed"><Amount wei={item.claimed} decimals={p.tokenDecimals} /></Figure>
          <Figure label="Claimable now" strong><Amount wei={item.claimable} decimals={p.tokenDecimals} /></Figure>
        </div>

        {p.type === 'vesting' && item.schedules && (
          <div className="space-y-3">{item.schedules.map((sc) => <ScheduleLine key={sc.scheduleId} sc={sc} decimals={p.tokenDecimals} symbol={sym} />)}</div>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        {claimable > 0n ? (
          <Button onClick={claim} loading={busy} className="w-full">Claim <Amount wei={claimable} decimals={p.tokenDecimals} symbol={sym} /></Button>
        ) : fullyClaimed ? (
          <div className="flex items-center justify-center gap-1.5 text-sm text-green-text py-1"><Check size={15} /> All claimed</div>
        ) : (
          <p className="text-sm text-muted text-center py-1">{unavailableReason(item)}</p>
        )}
      </CardBody>
    </Card>
  )
}

/** Request a signature; on CLAIM_PENDING_SYNC, sync locally pending transactions first and retry once */
async function requestSignature(project: string, account: string) {
  const req = () => api<{ amount: string; claimId: `0x${string}`; deadline: string; signature: `0x${string}` }>(
    `/api/projects/${project}/sign/request`, { json: { account } })
  try {
    return await req()
  } catch (e) {
    if (!(e instanceof ApiClientError) || e.code !== 'CLAIM_PENDING_SYNC') throw e
    for (const tx of listPending()) {
      try { await syncTx(tx.hash, { meta: tx.meta }); removePending(tx.hash) } catch { /* keep trying the next one */ }
    }
    return await req()
  }
}

function unavailableReason(item: EligibilityDTO): string {
  const p = item.project
  const now = Math.floor(Date.now() / 1000)
  if (p.status === 'paused') return 'Claiming is paused by the project.'
  if (p.status === 'upcoming' && p.startTime) return `Claiming opens ${relativeTime(p.startTime, now)} (${formatDateTime(p.startTime)}).`
  if (p.status === 'ended') return 'The claim window has closed.'
  if (p.type === 'vesting') {
    // Unlocking has started (already claimed, or a schedule is past TGE) -> it's just that not enough has accrued yet
    const started = BigInt(item.claimed) > 0n || (item.schedules ?? []).some((s) => !s.revoked && now >= s.tgeTime)
    return started ? 'You are up to date — more unlocks over time.' : 'Nothing unlocked yet — check back later.'
  }
  return 'Nothing to claim right now.'
}

function Figure({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{children}</div>
    </div>
  )
}

/** One vesting schedule: unlock progress + next unlock time */
function ScheduleLine({ sc, decimals, symbol }: { sc: ScheduleDTO; decimals: number; symbol: string | null }) {
  const now = Math.floor(Date.now() / 1000)
  const total = sc.revoked ? (BigInt(sc.claimed) + BigInt(sc.claimable)).toString() : sc.totalAmount
  const unlocked = (BigInt(sc.claimed) + BigInt(sc.claimable)).toString()
  return (
    <div className="rounded-btn border border-border p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Schedule #{sc.scheduleId}{sc.revoked && ' · revoked'}</span>
        <span className="text-ink"><Amount wei={unlocked} decimals={decimals} /> / <Amount wei={total} decimals={decimals} symbol={symbol} /> unlocked</span>
      </div>
      <Progress value={percent(unlocked, total === '0' ? '1' : total)} label="Unlocked" />
      <div className="text-xs text-muted">{nextUnlock(sc, now)}</div>
    </div>
  )
}

function nextUnlock(sc: ScheduleDTO, now: number): string {
  if (sc.revoked) return 'Revoked — no further unlocks.'
  const cliffEnd = sc.tgeTime + sc.cliffDuration
  const vestEnd = cliffEnd + sc.vestingDuration
  if (now >= vestEnd) return 'Fully unlocked.'
  if (now < sc.tgeTime) return `TGE ${relativeTime(sc.tgeTime, now)}: ${sc.tgeBps / 100}% unlocks.`
  if (now < cliffEnd) return `Cliff ends ${relativeTime(cliffEnd, now)}, then unlocks over ${formatDuration(sc.vestingDuration)}.`
  if (sc.interval === 0) return `Unlocking continuously until ${formatDateTime(vestEnd)}.`
  const next = cliffEnd + (Math.floor((now - cliffEnd) / sc.interval) + 1) * sc.interval
  return `Next unlock ${relativeTime(Math.min(next, vestEnd), now)} · every ${formatDuration(sc.interval)} until ${formatDateTime(vestEnd)}.`
}
