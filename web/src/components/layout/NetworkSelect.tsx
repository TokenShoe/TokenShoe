'use client'
/**
 * Nav dropdown for picking the network (Arc Testnet / Arc Mainnet).
 * Testnet gets an amber dot, mainnet a green one; networks without TokenShoe contracts say "Coming soon".
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { isDeployed, NETWORK_KEYS, NETWORKS, type NetworkConfig } from '@/config/networks'
import { useNetwork } from '@/hooks/useNetwork'

function Dot({ n }: { n: NetworkConfig }) {
  return <span className={clsx('w-2 h-2 rounded-full shrink-0', n.chain.testnet ? 'bg-[#F59E0B]' : 'bg-green')} aria-hidden />
}

export function NetworkSelect() {
  const { network, setNetwork } = useNetwork()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Network: ${network.label}`}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-[12px] text-sm font-medium text-ink bg-surface border border-border hover:bg-black/[0.03] transition-colors"
      >
        <Dot n={network} />
        {/* Phones: just the colored dot; the menu shows full names */}
        <span className="hidden sm:inline">{network.label}</span>
        <ChevronDown size={14} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul role="listbox" aria-label="Network"
          className="absolute right-0 mt-2 w-60 bg-surface border border-border rounded-card shadow-card py-1 z-50">
          {NETWORK_KEYS.map((key) => {
            const n = NETWORKS[key]
            const selected = key === network.key
            return (
              <li key={key} role="option" aria-selected={selected}>
                <button
                  onClick={() => { setOpen(false); setNetwork(key) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
                >
                  <Dot n={n} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-ink">{n.label}</span>
                    <span className="block text-xs text-muted">
                      Chain ID {n.chain.id}{isDeployed(n) ? '' : ' · Coming soon'}
                    </span>
                  </span>
                  {selected && <Check size={14} className="text-ink" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
