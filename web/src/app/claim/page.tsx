'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Card, CardBody } from '@/components/ui/Card'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { Tabs, Pager } from '@/components/ui/Tabs'
import { Table } from '@/components/ui/Data'
import { ClaimCard } from '@/components/project/ClaimCard'
import { AddressLink, Amount, TypeBadge } from '@/components/project/Bits'
import { useAccountClaims, useClaimable } from '@/hooks/queries'
import { formatDateTime } from '@/lib/client/format'

type Tab = 'open' | 'done' | 'history'

export default function ClaimPage() {
  const { address, isConnected } = useAccount()
  const [tab, setTab] = useState<Tab>('open')
  const [page, setPage] = useState(1)
  const q = useClaimable(address)
  const history = useAccountClaims(address, page)

  if (!isConnected) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardBody className="py-14 text-center space-y-4">
          <h1 className="font-display font-semibold text-xl text-ink">Your airdrops & vesting</h1>
          <p className="text-sm text-muted">Connect your wallet to see everything you can claim.</p>
          <div className="flex justify-center"><ConnectKitButton /></div>
        </CardBody>
      </Card>
    )
  }

  const items = q.data?.items ?? []
  // "Completed" = fully claimed, or the window has closed with nothing left to claim
  const done = items.filter((i) => BigInt(i.claimable) === 0n && (BigInt(i.claimed) >= BigInt(i.allocated) || i.project.status === 'ended'))
  const open = items.filter((i) => !done.includes(i))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Claim</h1>
        <p className="text-muted text-sm mt-1">Airdrops and vesting schedules for your connected wallet.</p>
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'open', label: 'Available & upcoming', count: open.length },
        { key: 'done', label: 'Completed', count: done.length },
        { key: 'history', label: 'History', count: history.data?.total },
      ]} />

      {tab !== 'history' && (q.isLoading ? <Loading /> : (tab === 'open' ? open : done).length ? (
        <div className="space-y-3">{(tab === 'open' ? open : done).map((i) => <ClaimCard key={i.project.address} item={i} />)}</div>
      ) : (
        <Card><EmptyState title={tab === 'open' ? 'Nothing to claim right now' : 'No completed claims yet'}>
          {tab === 'open' && 'When a project adds your address to a list, it shows up here.'}
        </EmptyState></Card>
      ))}

      {tab === 'history' && (history.isLoading ? <Loading /> : history.data?.items.length ? (
        <Card><CardBody>
          <Table head={['Project', 'Amount', 'When', 'Tx']}>
            {history.data.items.map((c) => (
              <tr key={c.id}>
                <td className="py-2.5 pr-4"><Link href={`/projects/${c.projectAddress}`} className="text-ink hover:underline">{c.project?.projectName}</Link> <span className="ml-1"><TypeBadge type={c.type} /></span></td>
                <td className="py-2.5 pr-4 whitespace-nowrap"><Amount wei={c.amount} decimals={c.project?.tokenDecimals ?? 18} symbol={c.project?.tokenSymbol} /></td>
                <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{formatDateTime(c.claimedAt)}</td>
                <td className="py-2.5"><AddressLink address={c.txHash} tx /></td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={20} total={history.data.total} onChange={setPage} />
        </CardBody></Card>
      ) : <Card><EmptyState title="No claims yet" /></Card>)}
    </div>
  )
}
