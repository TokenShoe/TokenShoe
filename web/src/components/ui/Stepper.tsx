import { clsx } from 'clsx'
import { Check } from 'lucide-react'

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={step} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                  done && 'bg-ink text-white',
                  active && 'bg-ink text-white ring-4 ring-ink/10',
                  !done && !active && 'bg-border text-muted',
                )}
              >
                {done ? <Check size={12} /> : i + 1}
              </div>
              <span
                className={clsx(
                  'text-xs font-medium hidden sm:block',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  'w-8 sm:w-12 h-px mx-2 transition-colors',
                  i < current ? 'bg-ink' : 'bg-border',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
