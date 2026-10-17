/**
 * GET /api/accounts/:account/claims?page=&pageSize=  - claim history of this address (with project name and token info)
 */
import { z } from 'zod'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { claims, projects } from '@/db/schema'
import { json, parseQuery, route, zAddress, zPage } from '@/lib/http'

export const dynamic = 'force-dynamic'

export const GET = route<{ params: { account: string } }>('accounts.claims', async (req, { params }) => {
  const account = zAddress.parse(params.account)
  const q = parseQuery(req, z.object({ ...zPage }))
  const where = eq(claims.account, account)
  const [items, [{ total }]] = await Promise.all([
    db.select({
      claim: claims,
      projectName: projects.name,
      tokenAddress: projects.tokenAddress,
      tokenSymbol: projects.tokenSymbol,
      tokenDecimals: projects.tokenDecimals,
    }).from(claims).innerJoin(projects, eq(projects.address, claims.projectAddress))
      .where(where).orderBy(desc(claims.claimedAt), desc(claims.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(claims).where(where),
  ])
  return json({
    items: items.map(({ claim, ...p }) => ({ ...claim, project: p })),
    total, page: q.page, pageSize: q.pageSize,
  })
})
