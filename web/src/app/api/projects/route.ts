/**
 * GET /api/projects  - project list (newest first)
 *   ?creator=0x...   only projects created by this address
 *   ?type=merkle|sign|vesting
 *   ?page=1&pageSize=20
 * Returns: { items: Project[], total, page, pageSize }
 */
import { z } from 'zod'
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects, projectStats } from '@/db/schema'
import { json, parseQuery, route, zAddress, zPage } from '@/lib/http'
import { projectView } from '@/lib/views'

export const dynamic = 'force-dynamic'

const Query = z.object({
  creator: zAddress.optional(),
  type: z.enum(['merkle', 'sign', 'vesting']).optional(),
  ...zPage,
})

export const GET = route('projects.list', async (req) => {
  const q = parseQuery(req, Query)
  const conds: SQL[] = []
  if (q.creator) conds.push(eq(projects.creator, q.creator))
  if (q.type) conds.push(eq(projects.type, q.type))
  const where = conds.length ? and(...conds) : undefined

  const [rows, [{ total }]] = await Promise.all([
    db().select({ project: projects, stats: projectStats })
      .from(projects)
      .leftJoin(projectStats, eq(projects.address, projectStats.projectAddress))
      .where(where)
      .orderBy(desc(projects.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(projects).where(where),
  ])

  return json({ items: rows.map((r) => projectView(r.project, r.stats)), total, page: q.page, pageSize: q.pageSize })
})
