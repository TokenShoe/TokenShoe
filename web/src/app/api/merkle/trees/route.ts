/**
 * POST /api/merkle/trees  - upload a Merkle airdrop CSV and build the Merkle tree (sign-in required)
 *
 * multipart/form-data:
 *   file      CSV file, one "address,amount" per line, header optional
 *   token     token address (the backend reads decimals to convert amounts); or pass decimals directly
 *   decimals  optional, token decimals
 *   unit      optional, token (default, amounts in token units) | wei (amounts in base units)
 *
 * Returns: { root, totalEntries, totalAmount(wei), decimals, preview: first 5 rows }
 *
 * Usage:
 *  - Before creating a project: upload -> put the root into createProject's initData
 *  - Replacing the list before start: upload again -> call setRoot with the new root -> submit the setRoot tx to /api/tx
 * The same list always yields the same root, so re-uploading never creates duplicate data.
 */
import { db } from '@/db/client'
import { merkleTrees, merkleEntries } from '@/db/schema'
import { json, route } from '@/lib/http'
import { requireSession } from '@/lib/auth'
import { readCsvFile, parseAllocationCsv, resolveDecimals, zUnit } from '@/lib/csv'
import { buildMerkleTree } from '@/lib/merkle'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby caps functions at 60s

export const POST = route('merkle.upload', async (req) => {
  const { address: uploader } = requireSession(req)
  const form = await req.formData()
  const file = form.get('file') as File | null
  const unit = zUnit.parse(form.get('unit') ?? undefined)
  const decimals = await resolveDecimals(form)

  const rows = parseAllocationCsv(await readCsvFile(file), decimals, unit)
  const tree = buildMerkleTree(rows)

  await db().transaction(async (tx) => {
    const inserted = await tx.insert(merkleTrees).values({
      root: tree.root,
      totalEntries: tree.entries.length,
      totalAmount: tree.totalAmount.toString(),
      tokenDecimals: decimals,
      uploader,
      fileName: file?.name?.slice(0, 200),
    }).onConflictDoNothing().returning()
    if (inserted.length === 0) return // the same list was uploaded before

    const CHUNK = 1000
    for (let i = 0; i < tree.entries.length; i += CHUNK) {
      await tx.insert(merkleEntries).values(
        tree.entries.slice(i, i + CHUNK).map((e) => ({
          root: tree.root, index: e.index, account: e.account, amount: e.amount.toString(), proof: e.proof,
        })),
      )
    }
  })

  log.info('merkle.tree_built', { root: tree.root, entries: tree.entries.length, uploader })
  return json({
    root: tree.root,
    totalEntries: tree.entries.length,
    totalAmount: tree.totalAmount.toString(),
    decimals,
    preview: tree.entries.slice(0, 5).map(({ index, account, amount }) => ({ index, account, amount: amount.toString() })),
  })
})
