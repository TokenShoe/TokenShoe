'use client'
/**
 * Project page
 *  - Everyone: overview stats, claim window, my allocation (when a wallet is connected), claims, timeline, recipient list / schedules
 *  - Project creator: an extra "Manage" tab
 */
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Globe } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { StatTile, Progress, KV } from '@/components/ui/Data'
import { Loading, EmptyState, Notice } from '@/components/ui/Feedback'
import { Tabs } from '@/components/ui/Tabs'
import { LinkButton } from '@/components/ui/Button'
import { TypeBadge, StatusBadge, AddressLink, Amount } from '@/components/project/Bits'
import { ClaimCard } from '@/components/project/ClaimCard'
import { ClaimsTable, ActivityTable, MerkleEntriesTable, VestingSchedulesTable } from '@/components/project/Tables'
import { DetailsForm, FundPanel, PausePanel, WithdrawPanel } from '@/components/project/manage/Common'
import { MerkleManage, SignManage, VestingManage } from '@/components/project/manage/TypeManage'
import { useEligibility, useProject } from '@/hooks/queries'
import { formatDateTime, formatDuration, percent, plural, relativeTime } from '@/lib/client/format'
import type { ProjectDTO } from '@/lib/client/types'

type Tab = 'claims' | 'recipients' | 'activity' | 'manage'

export default function ProjectPage({ params }: { params: { address: string } }) {
  const address = params.address.toLowerCase()
  const q = useProject(address)
  const { address: me } = useAccount()

  if (q.isLoading) return <Loading />
  if (!q.data) {
    return (
      <Card><EmptyState title="Project not found" action={<LinkButton href="/explore" size="sm" variant="secondary">Explore projects</LinkButton>}>
        If you just created it, it may still be syncing — refresh in a moment.
      </EmptyState></Card>
    )
  }
  return <ProjectView p={q.data} isCreator={!!me && me.toLowerCase() === q.data.creator} me={me} />
}

function ProjectView({ p, isCreator, me }: { p: ProjectDTO; isCreator: boolean; me?: string }) {
  const [tab, setTab] = useState<Tab>(isCreator ? 'manage' : 'claims')
  const mine = useEligibility(p.address, me?.toLowerCase())
  const pct = percent(p.totalClaimed, p.totalFunded)
  const now = Math.floor(Date.now() / 1000)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap"><TypeBadge type={p.type} /><StatusBadge status={p.status} /></div>
        <h1 className="font-display font-bold text-3xl text-ink tracking-tight-display">{p.name}</h1>
        {p.description && <p className="text-muted max-w-2xl whitespace-pre-line">{p.description}</p>}
        <div className="flex items-center gap-4 flex-wrap text-xs text-muted">
          <span>Contract <AddressLink address={p.address} /></span>
          <span>Token <AddressLink address={p.tokenAddress} /> {p.tokenSymbol}</span>
          <span>Creator <AddressLink address={p.creator} /></span>
          {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink"><Globe size={12} /> Website</a>}
          {p.twitter && <span>X: {p.twitter}</span>}
          {p.telegram && <span>Telegram: {p.telegram}</span>}
        </div>
      </div>

      {p.type === 'sign' && p.signerReady === false && (
        <Notice tone="warning" title="Claims unavailable">The project has not configured its signer key yet.</Notice>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Deposited" value={<Amount wei={p.totalFunded} decimals={p.tokenDecimals} symbol={p.tokenSymbol} maxFrac={2} />} />
        <StatTile label="Claimed" value={<Amount wei={p.totalClaimed} decimals={p.tokenDecimals} maxFrac={2} />}
          sub={<><Progress value={pct} className="mt-1 mb-1" label="Claimed share" />{pct.toFixed(1)}% of deposit</>} />
        <StatTile label="Recipients" value={p.stats.recipients.toLocaleString('en-US')} />
        <StatTile label="Claimed by" value={p.stats.claimerCount.toLocaleString('en-US')} sub={plural(p.stats.claimCount, 'claim transaction')} />
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-4 min-w-0 order-2 lg:order-1">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            ...(isCreator ? [{ key: 'manage' as const, label: 'Manage' }] : []),
            { key: 'claims', label: 'Claims', count: p.stats.claimCount },
            ...(p.type !== 'sign' ? [{ key: 'recipients' as const, label: p.type === 'vesting' ? 'Schedules' : 'Recipients' }] : []),
            { key: 'activity', label: 'Activity' },
          ]} />
          <Card><CardBody>
            {tab === 'claims' && <ClaimsTable p={p} />}
            {tab === 'activity' && <ActivityTable p={p} />}
            {tab === 'recipients' && p.type === 'merkle' && <MerkleEntriesTable p={p} />}
            {tab === 'recipients' && p.type === 'vesting' && <VestingSchedulesTable p={p} />}
            {tab === 'manage' && isCreator && (
              <div>
                {p.type === 'merkle' && <MerkleManage p={p} />}
                {p.type === 'sign' && <SignManage p={p} />}
                {p.type === 'vesting' && <VestingManage p={p} />}
                <FundPanel p={p} />
                {p.type !== 'vesting' && <PausePanel p={p} />}
                <WithdrawPanel p={p} />
                <DetailsForm p={p} />
              </div>
            )}
          </CardBody></Card>
        </div>

        <div className="space-y-4 order-1 lg:order-2">
          {me && mine.data && (mine.data.eligible ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-ink">Your allocation</div>
              <ClaimCard item={mine.data} showProject={false} />
            </div>
          ) : !isCreator && (
            <Card><CardBody className="text-sm text-muted">Your connected wallet is not on this project&apos;s list.</CardBody></Card>
          ))}
          <Card><CardBody>
            {p.type !== 'vesting' ? (
              <>
                <KV label="Claim opens">{formatDateTime(p.startTime)}</KV>
                <KV label="Claim closes">{formatDateTime(p.effectiveEndTime)}</KV>
                {p.effectiveEndTime !== null && p.endTime !== null && p.effectiveEndTime > p.endTime && (
                  <KV label="Extended by pauses">{formatDuration(p.effectiveEndTime - p.endTime)}</KV>
                )}
                {p.status === 'upcoming' && p.startTime && <KV label="Starts">{relativeTime(p.startTime, now)}</KV>}
                {p.status === 'active' && p.effectiveEndTime && <KV label="Ends">{relativeTime(p.effectiveEndTime, now)}</KV>}
              </>
            ) : (
              <KV label="Unlocks">Per-beneficiary schedule</KV>
            )}
            <KV label="Created">{formatDateTime(p.createdAt)}</KV>
            <KV label="Creation tx"><AddressLink address={p.createdTx} tx /></KV>
          </CardBody></Card>
        </div>
      </div>
    </div>
  )
}
