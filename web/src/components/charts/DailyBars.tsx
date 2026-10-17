'use client'
/**
 * Single-series column chart: daily counts for the last N days.
 * Spec: bars <= 24px wide, 4px rounded top / square base, 2px gaps, 1px light gridlines;
 * each full column is a hover/focus target showing the date and value; can switch to a table view.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatCompact } from '@/lib/client/format'

const SERIES = '#2a78d6'   // reference palette slot 1 (blue), validated against the white surface
const GRID = '#EAEAEA'
const H = 180
const PAD = { top: 12, right: 8, bottom: 22, left: 34 }

function niceMax(v: number): number {
  if (v <= 4) return 4
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

export function DailyBars({ data, unit }: { data: { day: string; value: number }[]; unit: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  useLayoutEffect(() => {
    if (wrapRef.current) setWidth(wrapRef.current.clientWidth)
  }, [])
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [asTable])

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const innerW = Math.max(0, width - PAD.left - PAD.right)
  const innerH = H - PAD.top - PAD.bottom
  const band = data.length ? innerW / data.length : 0
  const barW = Math.max(2, Math.min(24, band - 2))
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const ticks = [0, max / 2, max]
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={() => setAsTable(!asTable)} className="text-xs text-muted hover:text-ink underline">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted border-b border-border"><th className="py-1.5">Day (UTC)</th><th className="py-1.5 text-right">{unit}</th></tr></thead>
            <tbody className="divide-y divide-border">
              {[...data].reverse().map((d) => (
                <tr key={d.day}><td className="py-1.5 text-muted">{dayLabel(d.day, { year: 'numeric', month: 'short', day: 'numeric' })}</td><td className="py-1.5 text-right font-mono-data">{d.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label={`${unit} per day, ${total} in total`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted" fontSize={10}>{formatCompact(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2
              const h = (d.value / max) * innerH
              const top = PAD.top + innerH - h
              const r = Math.min(4, barW / 2, h)
              // Path with rounded top corners and a square base
              const x0 = cx - barW / 2, x1 = cx + barW / 2, base = PAD.top + innerH
              const path = h > 0
                ? `M${x0},${base} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x1 - r},${top} Q${x1},${top} ${x1},${top + r} L${x1},${base} Z`
                : ''
              return (
                <g key={d.day}>
                  {path && <path d={path} fill={SERIES} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 6} textAnchor="middle" className="fill-muted" fontSize={10}>{dayLabel(d.day)}</text>
                  )}
                  {/* Transparent full-column hit area: much larger than the bar, works with mouse and keyboard */}
                  <rect
                    x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="transparent"
                    tabIndex={0} aria-label={`${dayLabel(d.day)}: ${d.value} ${unit}`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    style={{ outline: 'none' }}
                  />
                </g>
              )
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-btn border border-border bg-surface px-2.5 py-1.5 shadow-hover"
              style={{ left: Math.min(Math.max(PAD.left + band * hover + band / 2, 50), width - 50), top: Math.max(y(data[hover].value) - 6, 40) }}
            >
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES }} />
                <span className="text-sm font-semibold text-ink">{data[hover].value.toLocaleString('en-US')}</span>
              </div>
              <div className="text-[11px] text-muted whitespace-nowrap">{unit} · {dayLabel(data[hover].day)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
