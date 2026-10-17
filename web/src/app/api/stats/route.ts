/**
 * GET /api/stats  - platform stats (shown on the home page)
 * Returns: { totalProjects, totalMerkle, totalSign, totalVesting, totalCreators,
 *         totalClaims, totalClaimers, totalRecipients, updatedAt }
 *   totalClaims     number of claims
 *   totalClaimers   distinct addresses that claimed
 *   totalRecipients sum of recipients across all projects (an address in several projects is counted once per project)
 */
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { platformStats, projectStats } from '@/db/schema'
import { json, route } from '@/lib/http'

export const dynamic = 'force-dynamic'

export const GET = route('stats.platform', async () => {
  const [[row], [{ totalRecipients }]] = await Promise.all([
    db.select().from(platformStats),
    db.select({ totalRecipients: sql<number>`coalesce(sum(${projectStats.recipients}), 0)::int` }).from(projectStats),
  ])
  const base = row ?? {
    totalProjects: 0, totalMerkle: 0, totalSign: 0, totalVesting: 0,
    totalCreators: 0, totalClaims: 0, totalClaimers: 0, updatedAt: null,
  }
  const { id: _id, ...rest } = base as typeof base & { id?: number }
  return json({ ...rest, totalRecipients }, { headers: { 'cache-control': 'public, max-age=10' } })
})
