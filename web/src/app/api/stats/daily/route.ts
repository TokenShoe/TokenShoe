/**
 * GET /api/stats/daily?days=30  - per-day new projects / claims / new claimers for the last N days (UTC), for the trend chart
 * Days without data are filled with 0, so the date series is continuous.
 */
import { z } from 'zod'
import { gte } from 'drizzle-orm'
import { db } from '@/db/client'
import { dailyStats } from '@/db/schema'
import { json, parseQuery, route } from '@/lib/http'
import { utcDay } from '@/lib/stats'

export const dynamic = 'force-dynamic'

export const GET = route('stats.daily', async (req) => {
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }))
  const from = new Date(Date.now() - (days - 1) * 86400_000)
  const rows = await db.select().from(dailyStats).where(gte(dailyStats.day, utcDay(from)))
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const items = Array.from({ length: days }, (_, i) => {
    const day = utcDay(new Date(from.getTime() + i * 86400_000))
    const r = byDay.get(day)
    return { day, projectsCreated: r?.projectsCreated ?? 0, claims: r?.claims ?? 0, newClaimers: r?.newClaimers ?? 0 }
  })
  return json({ items }, { headers: { 'cache-control': 'public, max-age=60' } })
})
