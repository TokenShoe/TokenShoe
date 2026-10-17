/**
 * GET /api/merkle/trees/:root?page=&pageSize=&account=  - view a Merkle list (without proofs)
 */
import { z } from 'zod'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { merkleTrees, merkleEntries } from '@/db/schema'
import { ApiError, json, parseQuery, route, zAddress, zPage } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Query = z.object({ account: zAddress.optional(), ...zPage })

export const GET = route<{ params: { root: string } }>('merkle.tree', async (req, { params }) => {
  const root = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(params.root).toLowerCase()
  const q = parseQuery(req, Query)
  const [tree] = await db().select().from(merkleTrees).where(eq(merkleTrees.root, root))
  if (!tree) throw new ApiError(404, 'TREE_NOT_FOUND', 'Recipient list not found')

  const where = and(eq(merkleEntries.root, root), q.account ? eq(merkleEntries.account, q.account) : undefined)
  const [items, [{ total }]] = await Promise.all([
    db().select({ index: merkleEntries.index, account: merkleEntries.account, amount: merkleEntries.amount })
      .from(merkleEntries).where(where).orderBy(asc(merkleEntries.index))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(merkleEntries).where(where),
  ])
  return json({ tree, items, total, page: q.page, pageSize: q.pageSize })
})
