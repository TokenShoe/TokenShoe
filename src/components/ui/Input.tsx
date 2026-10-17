import { clsx } from 'clsx'

export function Input({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label?: string
  hint?: string
  error?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        {...props}
        className={clsx(
          'w-full px-3 py-2 text-sm bg-surface border rounded-btn outline-none transition-colors',
          'placeholder:text-muted',
          error
            ? 'border-red focus:ring-2 focus:ring-red/20'
            : 'border-border focus:border-ink focus:ring-2 focus:ring-ink/10',
          props.disabled && 'opacity-50 cursor-not-allowed bg-black/5',
          className,
        )}
      />
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-red-text">{error}</p>}
    </div>
  )
}

export function Select({
  label,
  hint,
  error,
  children,
  className,
  ...props
}: {
  label?: string
  hint?: string
  error?: string
  children: React.ReactNode
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-ink">{label}</label>}
      <select
        {...props}
        className={clsx(
          'w-full px-3 py-2 text-sm bg-surface border rounded-btn outline-none transition-colors appearance-none',
          error ? 'border-red' : 'border-border focus:border-ink focus:ring-2 focus:ring-ink/10',
          className,
        )}
      >
        {children}
      </select>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-red-text">{error}</p>}
    </div>
  )
}
