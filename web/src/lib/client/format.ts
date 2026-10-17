/**
 * Display formatting: amounts, addresses, dates, durations
 */
import { formatUnits, parseUnits } from 'viem'

/** wei -> token amount with thousands separators, max 4 decimals by default (tiny values show as <0.0001 instead of rounding to 0) */
export function formatToken(wei: string | bigint | null | undefined, decimals: number, maxFrac = 4): string {
  if (wei === null || wei === undefined) return '—'
  const v = typeof wei === 'bigint' ? wei : BigInt(wei)
  if (v === 0n) return '0'
  const s = formatUnits(v, decimals)
  const [int, frac = ''] = s.split('.')
  const fracTrim = frac.slice(0, maxFrac).replace(/0+$/, '')
  if (int === '0' && !fracTrim) return `<0.${'0'.repeat(maxFrac - 1)}1`
  const intFmt = BigInt(int).toLocaleString('en-US')
  return fracTrim ? `${intFmt}.${fracTrim}` : intFmt
}

/** Compact number: 1234 -> 1.2K */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export const shortAddr = (a?: string | null, head = 6, tail = 4) =>
  a ? `${a.slice(0, head)}…${a.slice(-tail)}` : '—'

export function formatDateTime(unixOrIso: number | string | null | undefined): string {
  if (unixOrIso === null || unixOrIso === undefined) return '—'
  const d = typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso)
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(unixOrIso: number | string): string {
  const d = typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Seconds -> readable duration such as "3d 4h" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d >= 1) return h ? `${d}d ${h}h` : `${d}d`
  if (h >= 1) return m ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(m, 1)}m`
}

/** How long until / since a point in time */
export function relativeTime(unix: number, now = Math.floor(Date.now() / 1000)): string {
  const diff = unix - now
  return diff >= 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`
}

/** Percentage (bigint-safe) */
export function percent(part: string | bigint, total: string | bigint): number {
  const p = BigInt(part), t = BigInt(total)
  if (t === 0n) return 0
  return Number((p * 10000n) / t) / 100
}

/** <input type="datetime-local"> value <-> unix seconds (browser local time zone) */
export const localInputToUnix = (v: string) => Math.floor(new Date(v).getTime() / 1000)
export function unixToLocalInput(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** User-entered token amount (thousands commas allowed) -> wei; returns null for invalid input or too many decimals */
export function parseTokenInput(v: string, decimals: number): bigint | null {
  const t = v.replace(/[,_\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  if ((t.split('.')[1]?.length ?? 0) > decimals) return null
  return parseUnits(t, decimals)
}

/** wei -> plain number string with no separators and no truncation (for prefilling inputs) */
export const toInputAmount = (wei: string | bigint, decimals: number) => formatUnits(BigInt(wei), decimals)

/** English pluralization: plural(1, 'recipient') -> "1 recipient", plural(2, 'recipient') -> "2 recipients" */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`
}
