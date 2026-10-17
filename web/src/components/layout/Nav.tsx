'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { clsx } from 'clsx'
import { ConnectKitButton } from 'connectkit'
import { Layers, Menu, X } from 'lucide-react'

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/create', label: 'Create' },
  { href: '/claim', label: 'Claim' },
  { href: '/projects', label: 'My projects' },
]

export function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <nav className="sticky top-0 z-40 bg-canvas/90 backdrop-blur border-b border-border">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-display font-semibold text-ink tracking-tight-display">
          <span className="w-7 h-7 bg-ink rounded-[6px] flex items-center justify-center">
            <Layers size={14} className="text-white" />
          </span>
          TokenShoe
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={clsx(
              'px-3 py-1.5 rounded-btn text-sm font-medium transition-colors',
              isActive(l.href) ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-black/5',
            )}>{l.label}</Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ConnectKitButton />
          <button className="md:hidden p-2 rounded-btn hover:bg-black/5" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden border-t border-border px-4 py-2 flex flex-col">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={clsx(
              'px-3 py-2 rounded-btn text-sm font-medium',
              isActive(l.href) ? 'bg-ink text-white' : 'text-ink hover:bg-black/5',
            )}>{l.label}</Link>
          ))}
        </div>
      )}
    </nav>
  )
}
