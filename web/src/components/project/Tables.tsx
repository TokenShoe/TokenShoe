'use client'
/** Public tables on the project page: claims, timeline, Merkle list, vesting schedules */
import { useState } from 'react'
import { Search } from 'lucide-react'
import { Table } from '@/components/ui/Data'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { Pager } from '@/components/ui/Tabs'
import { AddressLink, Amount } from './Bits'
import { useMerkleTree, useProjectActivities, useProjectClaims, useVestingSchedules } from '@/hooks/queries'
import { formatDateTime, formatDuration, shortAddr } from '@/lib/client/format'
import type { ProjectDTO } from '@/lib/client/types'

export function ClaimsTable({ p }: { p: ProjectDTO }) {
  const [page, setPage] = useState(1)
  const q = useProjectClaims(p.address, page)
  if (q.isLoading) return <Loading />
  if (!q.data?.items.length) return <EmptyState title="No claims yet" />
  return (
    <>
      <Table head={['Recipient', 'Amount', 'When', 'Tx']}>
        {q.data.items.map((c) => (
          <tr key={c.id}>
            <td className="py-2.5 pr-4"><AddressLink address={c.account} /></td>
            <td className="py-2.5 pr-4 whitespace-nowrap"><Amount wei={c.amount} decimals={p.tokenDecimals} symbol={p.tokenSymbol} /></td>
            <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{formatDateTime(c.claimedAt)}</td>
            <td className="py-2.5"><AddressLink address={c.txHash} tx /></td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
    </>
  )
}

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Project created', funded: 'Funded', withdrawn: 'Withdrawn', paused: 'Paused', unpaused: 'Resumed',
  root_updated: 'Recipient list replaced', signer_updated: 'Signer changed', schedule_created: 'Schedule added',
  schedule_revoked: 'Schedule revoked', creator_transfer_initiated: 'Ownership transfer started', creator_transferred: 'Ownership transferred',
}

export function ActivityTable({ p }: { p: ProjectDTO }) {
  const [page, setPage] = useState(1)
  const q = useProjectActivities(p.address, page)
  if (q.isLoading) return <Loading />
  if (!q.data?.items.length) return <EmptyState title="No activity yet" />
  return (
    <>
      <Table head={['Event', 'Detail', 'When', 'Tx']}>
        {q.data.items.map((a) => (
          <tr key={a.id}>
            <td className="py-2.5 pr-4 text-ink whitespace-nowrap">{ACTIVITY_LABEL[a.kind] ?? a.kind}</td>
            <td className="py-2.5 pr-4 text-muted">
              {a.amount && <Amount wei={a.amount} decimals={p.tokenDecimals} symbol={p.tokenSymbol} />}
              {a.amount && a.actor && ' · '}
              {a.actor && <span className="font-mono-data text-xs">{shortAddr(a.actor)}</span>}
              {a.kind === 'schedule_revoked' && `#${a.data?.scheduleId}`}
            </td>
            <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{formatDateTime(a.at)}</td>
            <td className="py-2.5"><AddressLink address={a.txHash} tx /></td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
    </>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search address (0x…)' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} spellCheck={false}
        className="w-full pl-8 pr-3 py-2 text-sm bg-surface border border-border rounded-btn outline-none focus:border-ink focus:ring-2 focus:ring-ink/10" />
    </div>
  )
}

/** Only search once a full address has been entered */
export const fullAddress = (v: string) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : '')

export function MerkleEntriesTable({ p }: { p: ProjectDTO }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const q = useMerkleTree(p.merkleRoot, page, fullAddress(search))
  if (!p.merkleRoot) return <EmptyState title="No list" />
  return (
    <div className="space-y-3">
      <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1) }} />
      {q.isLoading ? <Loading /> : q.isError ? <EmptyState title="List not found on server" /> : q.data?.items.length ? (
        <>
          <Table head={['#', 'Recipient', 'Amount']}>
            {q.data.items.map((e) => (
              <tr key={e.index}>
                <td className="py-2 pr-4 text-muted font-mono-data text-xs">{e.index}</td>
                <td className="py-2 pr-4"><AddressLink address={e.account} /></td>
                <td className="py-2 whitespace-nowrap"><Amount wei={e.amount} decimals={p.tokenDecimals} symbol={p.tokenSymbol} /></td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
        </>
      ) : <EmptyState title="No matching recipient" />}
    </div>
  )
}

export function VestingSchedulesTable({ p, action }: { p: ProjectDTO; action?: (s: { scheduleId: number; revocable: boolean; revoked: boolean }) => React.ReactNode }) {
  const [page, setPage] = useState(1)
  const q = useVestingSchedules(p.address, page)
  if (q.isLoading) return <Loading />
  if (!q.data?.items.length) return <EmptyState title="No schedules" />
  return (
    <>
      <Table head={['#', 'Beneficiary', 'Total', 'Unlocked', 'Claimed', 'Terms', ...(action ? [''] : [])]}>
        {q.data.items.map((s) => (
          <tr key={s.scheduleId}>
            <td className="py-2.5 pr-4 text-muted font-mono-data text-xs">{s.scheduleId}</td>
            <td className="py-2.5 pr-4"><AddressLink address={s.beneficiary} /></td>
            <td className="py-2.5 pr-4 whitespace-nowrap"><Amount wei={s.totalAmount} decimals={p.tokenDecimals} /></td>
            <td className="py-2.5 pr-4 whitespace-nowrap"><Amount wei={s.unlocked} decimals={p.tokenDecimals} /></td>
            <td className="py-2.5 pr-4 whitespace-nowrap"><Amount wei={s.claimed} decimals={p.tokenDecimals} /></td>
            <td className="py-2.5 pr-4 text-xs text-muted whitespace-nowrap">
              TGE {formatDateTime(s.tgeTime)} · {s.tgeBps / 100}% · cliff {formatDuration(s.cliffDuration) || '0'} · {formatDuration(s.vestingDuration) || '0'}
              {s.interval ? ` every ${formatDuration(s.interval)}` : ' linear'}
              {s.revoked ? ' · revoked' : s.revocable ? ' · revocable' : ''}
            </td>
            {action && <td className="py-2.5 text-right">{action(s)}</td>}
          </tr>
        ))}
      </Table>
      <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
    </>
  )
}
