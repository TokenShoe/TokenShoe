import { clsx } from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantCls: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-accent-hover active:scale-[0.98]',
  secondary: 'border border-border text-ink hover:bg-black/5',
  ghost: 'text-muted hover:text-ink hover:bg-black/5',
  danger: 'bg-red text-white hover:opacity-90 active:scale-[0.98]',
}

const sizeCls: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  loading,
  onClick,
  type = 'button',
}: {
  children: React.ReactNode
  variant?: Variant
  size?: Size
  className?: string
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-btn font-medium transition-all',
        variantCls[variant],
        sizeCls[size],
        (disabled || loading) && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" />
        </svg>
      )}
      {children}
    </button>
  )
}
