import { clsx } from 'clsx'

/** Stat tile: a label + a number (big numbers use proportional, not tabular, figures) */
export function StatTile({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-surface border border-border rounded-card p-5', className)}>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink tracking-tight-display">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

/** Progress bar: value 0-100 */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={clsx('h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  )
}

/** Key-value row (detail lists) */
export function KV({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0 text-sm">
      <span className="text-muted shrink-0">{label}</span>
      <span className={clsx('text-ink text-right min-w-0 truncate', mono && 'font-mono-data text-xs')}>{children}</span>
    </div>
  )
}

/** Simple table shell */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
            {head.map((h, i) => <th key={i} className="py-2 pr-4 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}
