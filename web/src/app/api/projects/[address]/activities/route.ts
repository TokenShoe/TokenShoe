/**
 * GET /api/projects/:address/activities?page=&pageSize=  - project timeline (created, funded, withdrawn, paused, root replaced ...)
 */
import { z } from 'zod'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { projectActivities } from '@/db/schema'
import { json, parseQuery, route, zAddress, zPage } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Query = z.object({ ...zPage })

export const GET = route<{ params: { address: string } }>('projects.activities', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  const q = parseQuery(req, Query)
  const where = eq(projectActivities.projectAddress, address)
  const [items, [{ total }]] = await Promise.all([
    db.select().from(projectActivities).where(where).orderBy(desc(projectActivities.at), desc(projectActivities.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(projectActivities).where(where),
  ])
  return json({ items, total, page: q.page, pageSize: q.pageSize })
})
