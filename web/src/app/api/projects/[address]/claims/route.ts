/**
 * GET /api/projects/:address/claims?page=&pageSize=  - claims of a project (newest first)
 *   ?account=0x...  only this address
 */
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { claims } from '@/db/schema'
import { json, parseQuery, route, zAddress, zPage } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Query = z.object({ account: zAddress.optional(), ...zPage })

export const GET = route<{ params: { address: string } }>('projects.claims', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  const q = parseQuery(req, Query)
  const where = and(eq(claims.projectAddress, address), q.account ? eq(claims.account, q.account) : undefined)
  const [items, [{ total }]] = await Promise.all([
    db().select().from(claims).where(where).orderBy(desc(claims.claimedAt), desc(claims.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(claims).where(where),
  ])
  return json({ items, total, page: q.page, pageSize: q.pageSize })
})
