/**
 * GET /api/projects/:address/vesting/schedules?page=&pageSize=&beneficiary=  - all schedules of a vesting project
 * Each schedule includes claimable (claimable now) and unlocked (total unlocked so far), for the project management page.
 */
import { z } from 'zod'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { vestingSchedules } from '@/db/schema'
import { ApiError, json, parseQuery, route, zAddress, zPage } from '@/lib/http'
import { getProjectOr404 } from '@/lib/auth'
import { claimableAmount, unlockedAmount } from '@/lib/vesting'

export const dynamic = 'force-dynamic'

const Query = z.object({ beneficiary: zAddress.optional(), ...zPage })

export const GET = route<{ params: { address: string } }>('vesting.schedules', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  const q = parseQuery(req, Query)
  const project = await getProjectOr404(address)
  if (project.type !== 'vesting') throw new ApiError(400, 'WRONG_TYPE', 'This project is not a vesting project')

  const where = and(
    eq(vestingSchedules.projectAddress, address),
    q.beneficiary ? eq(vestingSchedules.beneficiary, q.beneficiary) : undefined,
  )
  const [rows, [{ total }]] = await Promise.all([
    db().select().from(vestingSchedules).where(where).orderBy(asc(vestingSchedules.scheduleId))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(vestingSchedules).where(where),
  ])
  const now = Math.floor(Date.now() / 1000)
  const items = rows.map((s) => {
    const like = {
      totalAmount: BigInt(s.totalAmount), claimed: BigInt(s.claimed), tgeTime: s.tgeTime, tgeBps: s.tgeBps,
      cliffDuration: s.cliffDuration, vestingDuration: s.vestingDuration, interval: s.interval,
      revoked: s.revoked, revokedClaimableCap: BigInt(s.revokedClaimableCap),
    }
    return {
      ...s,
      unlocked: (s.revoked ? like.revokedClaimableCap : unlockedAmount(like, now)).toString(),
      claimable: claimableAmount(like, now).toString(),
    }
  })
  return json({ items, total, page: q.page, pageSize: q.pageSize })
})
