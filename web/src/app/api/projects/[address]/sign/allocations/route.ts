/**
 * Signature airdrop allocation management (all endpoints require the project creator to be signed in). Changes take effect immediately.
 *
 * GET    ?page=&pageSize=&account=      list allocations + summary { totalAllocated, totalClaimed, count }
 * POST   multipart: file, unit?, mode?   upload a CSV (address,amount)
 *          mode=merge (default): addresses in the CSV are added or updated, everyone else is untouched
 *          mode=replace: the list becomes exactly the CSV; addresses not in it are deleted if they never claimed, otherwise locked at what they already claimed
 * PUT    JSON { account, amount, unit? }  add / update a single address
 * DELETE ?account=0x...                   remove a single address (if it already claimed, its allocation is locked at the claimed amount)
 *
 * Notes: allocation = the total an address can claim. Raising it for someone who already claimed lets them claim the difference.
 *        Issued but unused signatures stay valid until they expire (30 minutes by default); lowering an allocation does not revoke them immediately.
 */
import { z } from 'zod'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { db, type Tx } from '@/db/client'
import { signAllocations } from '@/db/schema'
import { ApiError, json, parseBody, parseQuery, route, zAddress, zPage } from '@/lib/http'
import { requireCreator } from '@/lib/auth'
import { readCsvFile, parseAllocationCsv, parseAmount, zUnit, type CsvRow } from '@/lib/csv'
import { refreshRecipients } from '@/lib/stats'
import { log } from '@/lib/logger'
import type { Project } from '@/db/schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Ctx = { params: { address: string } }

async function loadSignProject(req: Parameters<typeof requireCreator>[0], rawAddress: string): Promise<Project> {
  const project = await requireCreator(req, zAddress.parse(rawAddress))
  if (project.type !== 'sign') throw new ApiError(400, 'WRONG_TYPE', 'This project is not a signature airdrop')
  return project
}

/**
 * Bulk upsert allocation rows (allocation is overwritten, claimed amount unchanged).
 * Every row gets the same updatedAt stamp; replace mode uses it to find addresses that are not in this CSV.
 */
async function upsertRows(tx: Tx, project: string, rows: Pick<CsvRow, 'account' | 'amount'>[], stamp: Date) {
  const CHUNK = 1000
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(signAllocations)
      .values(rows.slice(i, i + CHUNK).map((r) => ({
        projectAddress: project, account: r.account, amount: r.amount.toString(), updatedAt: stamp,
      })))
      .onConflictDoUpdate({
        target: [signAllocations.projectAddress, signAllocations.account],
        set: { amount: sql`excluded.amount`, updatedAt: stamp },
      })
  }
}

/** "Remove" one or more addresses: delete rows that never claimed; lock the allocation at the claimed amount for the rest */
async function removeAccounts(tx: Tx, where: ReturnType<typeof and>) {
  await tx.delete(signAllocations).where(and(where, eq(signAllocations.claimed, '0')))
  await tx.update(signAllocations)
    .set({ amount: sql`${signAllocations.claimed}`, updatedAt: new Date() })
    .where(where)
}

async function summary(project: string) {
  const [s] = await db.select({
    count: sql<number>`count(*) filter (where ${signAllocations.amount} > 0)::int`,
    totalAllocated: sql<string>`coalesce(sum(${signAllocations.amount}), 0)::text`,
    totalClaimed: sql<string>`coalesce(sum(${signAllocations.claimed}), 0)::text`,
  }).from(signAllocations).where(eq(signAllocations.projectAddress, project))
  return s
}

const ListQuery = z.object({ account: zAddress.optional(), ...zPage })

export const GET = route<Ctx>('sign.alloc.list', async (req, { params }) => {
  const project = await loadSignProject(req, params.address)
  const q = parseQuery(req, ListQuery)
  const where = and(eq(signAllocations.projectAddress, project.address), q.account ? eq(signAllocations.account, q.account) : undefined)
  const [items, [{ total }], sum] = await Promise.all([
    db.select().from(signAllocations).where(where).orderBy(asc(signAllocations.createdAt), asc(signAllocations.account))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(signAllocations).where(where),
    summary(project.address),
  ])
  return json({ items, total, page: q.page, pageSize: q.pageSize, summary: sum })
})

export const POST = route<Ctx>('sign.alloc.upload', async (req, { params }) => {
  const project = await loadSignProject(req, params.address)
  const form = await req.formData()
  const unit = zUnit.parse(form.get('unit') ?? undefined)
  const mode = z.enum(['merge', 'replace']).default('merge').parse(form.get('mode') ?? undefined)
  const rows = parseAllocationCsv(await readCsvFile(form.get('file') as File | null), project.tokenDecimals, unit)

  await db.transaction(async (tx) => {
    const stamp = new Date()
    await upsertRows(tx, project.address, rows, stamp)
    if (mode === 'replace') {
      // Rows not touched by this upsert (updatedAt earlier than stamp) are the addresses missing from the new CSV
      await removeAccounts(tx,
        and(eq(signAllocations.projectAddress, project.address), lt(signAllocations.updatedAt, stamp)))
    }
    await refreshRecipients(tx, project.address)
  })

  log.info('sign.alloc.uploaded', { project: project.address, rows: rows.length, mode })
  return json({ mode, rows: rows.length, summary: await summary(project.address) })
})

const PutBody = z.object({ account: zAddress, amount: z.string().min(1), unit: zUnit })

export const PUT = route<Ctx>('sign.alloc.put', async (req, { params }) => {
  const project = await loadSignProject(req, params.address)
  const body = await parseBody(req, PutBody)
  const amount = parseAmount(body.amount, project.tokenDecimals, body.unit)
  if (typeof amount === 'string') throw new ApiError(400, 'BAD_AMOUNT', amount)
  if (amount === 0n) throw new ApiError(400, 'BAD_AMOUNT', 'Amount cannot be 0 (use DELETE to remove an address)')

  await db.transaction(async (tx) => {
    await upsertRows(tx, project.address, [{ account: body.account, amount }], new Date())
    await refreshRecipients(tx, project.address)
  })
  const [row] = await db.select().from(signAllocations)
    .where(and(eq(signAllocations.projectAddress, project.address), eq(signAllocations.account, body.account)))
  return json(row)
})

export const DELETE = route<Ctx>('sign.alloc.delete', async (req, { params }) => {
  const project = await loadSignProject(req, params.address)
  const { account } = parseQuery(req, z.object({ account: zAddress }))
  await db.transaction(async (tx) => {
    await removeAccounts(tx, and(eq(signAllocations.projectAddress, project.address), eq(signAllocations.account, account)))
    await refreshRecipients(tx, project.address)
  })
  return json({ ok: true })
})
