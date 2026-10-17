import { clsx } from 'clsx'

type Variant = 'green' | 'blue' | 'yellow' | 'red' | 'gray'

const variants: Record<Variant, string> = {
  green: 'bg-green-light text-green-text',
  blue: 'bg-blue-light text-blue-text',
  yellow: 'bg-yellow-light text-yellow-text',
  red: 'bg-red-light text-red-text',
  gray: 'bg-black/5 text-muted',
}

export function Badge({ children, variant = 'gray' }: { children: React.ReactNode; variant?: Variant }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[variant])}>
      {children}
    </span>
  )
}
