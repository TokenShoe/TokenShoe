/** Small project components: type badge, status badge, address link, token amount */
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { explorerAddress, explorerTx, type ProjectKind } from '@/config/chain'
import { formatToken, shortAddr } from '@/lib/client/format'
import type { ProjectStatus } from '@/lib/client/types'

export const TYPE_LABEL: Record<ProjectKind, string> = {
  merkle: 'Merkle airdrop',
  sign: 'Signature airdrop',
  vesting: 'Vesting',
}

export function TypeBadge({ type }: { type: ProjectKind }) {
  const v = { merkle: 'blue', sign: 'green', vesting: 'yellow' } as const
  return <Badge variant={v[type]}>{TYPE_LABEL[type]}</Badge>
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const map = {
    upcoming: { v: 'gray', l: '◷ Upcoming' },
    active: { v: 'green', l: '● Live' },
    paused: { v: 'yellow', l: '❚❚ Paused' },
    ended: { v: 'gray', l: '■ Ended' },
  } as const
  return <Badge variant={map[status].v}>{map[status].l}</Badge>
}

export function AddressLink({ address, full, tx }: { address: string; full?: boolean; tx?: boolean }) {
  return (
    <a
      href={tx ? explorerTx(address) : explorerAddress(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono-data text-xs text-ink hover:text-blue-text transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {full ? address : shortAddr(address)}
      <ExternalLink size={11} className="opacity-60" />
    </a>
  )
}

export function Amount({ wei, decimals, symbol, maxFrac }: { wei: string | bigint | null | undefined; decimals: number; symbol?: string | null; maxFrac?: number }) {
  return (
    <span className="whitespace-nowrap">
      {formatToken(wei, decimals, maxFrac)}
      {symbol && <span className="text-muted"> {symbol}</span>}
    </span>
  )
}
