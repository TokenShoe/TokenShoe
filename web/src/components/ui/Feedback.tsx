import { clsx } from 'clsx'
import { AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react'

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin w-4 h-4', className)} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" />
    </svg>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Spinner /> {label}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="py-12 text-center space-y-2">
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="text-sm text-muted max-w-sm mx-auto">{children}</div>}
      {action && <div className="pt-3">{action}</div>}
    </div>
  )
}

type Tone = 'info' | 'warning' | 'success' | 'error'
const tones: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'bg-blue-light text-blue-text', Icon: Info },
  warning: { cls: 'bg-yellow-light text-yellow-text', Icon: AlertTriangle },
  success: { cls: 'bg-green-light text-green-text', Icon: CheckCircle2 },
  error: { cls: 'bg-red-light text-red-text', Icon: XCircle },
}

/** Notice: icon + text (status is never conveyed by color alone) */
export function Notice({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: React.ReactNode; className?: string }) {
  const { cls, Icon } = tones[tone]
  return (
    <div className={clsx('flex gap-2.5 rounded-btn p-3 text-xs leading-relaxed', cls, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

/** Show the per-line CSV errors returned by the backend */
export function RowErrors({ errors }: { errors: { line: number; message: string }[] }) {
  return (
    <Notice tone="error" title={`${errors.length} row(s) need fixing`}>
      <ul className="space-y-0.5 max-h-48 overflow-y-auto">
        {errors.map((e, i) => (
          <li key={i}><span className="font-mono-data">Line {e.line}</span> — {e.message}</li>
        ))}
      </ul>
    </Notice>
  )
}
