'use client'
import { clsx } from 'clsx'

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap',
            value === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-3 text-xs text-muted">
      <span>{total.toLocaleString('en-US')} total</span>
      <div className="flex items-center gap-2">
        <button className="px-2 py-1 rounded-btn hover:bg-black/5 disabled:opacity-30" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <span>{page} / {pages}</span>
        <button className="px-2 py-1 rounded-btn hover:bg-black/5 disabled:opacity-30" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  )
}
