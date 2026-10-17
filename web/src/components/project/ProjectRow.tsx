/** One row in a project list: name, type, status, token, claim progress */
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Progress } from '@/components/ui/Data'
import { TypeBadge, StatusBadge, Amount } from './Bits'
import { percent, plural } from '@/lib/client/format'
import type { ProjectDTO } from '@/lib/client/types'

export function ProjectRow({ p }: { p: ProjectDTO }) {
  const pct = percent(p.totalClaimed, p.totalFunded)
  return (
    <Link href={`/projects/${p.address}`} className="block bg-surface border border-border rounded-card px-5 py-4 shadow-card hover:shadow-hover transition-shadow">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-ink truncate">{p.name}</span>
            <TypeBadge type={p.type} />
            <StatusBadge status={p.status} />
          </div>
          <div className="text-xs text-muted">
            {plural(p.stats.recipients, 'recipient')} · {p.stats.claimerCount.toLocaleString('en-US')} claimed
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block w-44">
            <div className="text-sm text-ink"><Amount wei={p.totalClaimed} decimals={p.tokenDecimals} maxFrac={2} /> / <Amount wei={p.totalFunded} decimals={p.tokenDecimals} symbol={p.tokenSymbol} maxFrac={2} /></div>
            <Progress value={pct} className="mt-1.5" label="Claimed" />
          </div>
          <ChevronRight size={16} className="text-muted" />
        </div>
      </div>
    </Link>
  )
}
