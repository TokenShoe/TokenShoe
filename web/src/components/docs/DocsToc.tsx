'use client'
/**
 * Docs sidebar: section links that highlight the section currently in view.
 * Desktop only — on small screens the page is short enough to scroll.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'

export interface TocItem { id: string; label: string }

export function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id)

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-section]'))
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      // A section counts as "current" while it sits in the upper part of the viewport
      { rootMargin: '-80px 0px -65% 0px' },
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])

  // Sections can be hidden on some networks (e.g. no test tokens); only list the ones rendered
  const [present, setPresent] = useState(items)
  useEffect(() => {
    setPresent(items.filter((i) => document.getElementById(i.id)))
  }, [items])

  return (
    <nav className="hidden lg:block sticky top-24 space-y-0.5" aria-label="On this page">
      <div className="text-xs font-medium text-muted uppercase tracking-wide pb-2">On this page</div>
      {present.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={clsx(
          'block px-2 py-1 -mx-2 rounded-btn text-sm transition-colors',
          active === i.id ? 'text-ink font-medium bg-black/[0.04]' : 'text-muted hover:text-ink',
        )}>{i.label}</a>
      ))}
    </nav>
  )
}
