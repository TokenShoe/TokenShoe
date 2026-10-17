/**
 * GET /api/projects/:address/merkle-proof?account=0x...  - fetch the proof before claiming a Merkle airdrop
 *
 * Returns: { index, account, amount, proof, claimed, claimTx }
 * The frontend then calls claim(index, account, amount, proof) and submits the tx to /api/tx once it succeeds.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { merkleEntries, claims } from '@/db/schema'
import { ApiError, json, parseQuery, route, zAddress } from '@/lib/http'
import { getProjectOr404 } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const Query = z.object({ account: zAddress })

export const GET = route<{ params: { address: string } }>('merkle.proof', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  const { account } = parseQuery(req, Query)
  const project = await getProjectOr404(address)
  if (project.type !== 'merkle') throw new ApiError(400, 'WRONG_TYPE', 'This project is not a Merkle airdrop')
  if (!project.merkleRoot) throw new ApiError(404, 'NO_ROOT', 'This project has no recipient list')

  const [entry] = await db.select().from(merkleEntries)
    .where(and(eq(merkleEntries.root, project.merkleRoot), eq(merkleEntries.account, account)))
  if (!entry) throw new ApiError(404, 'NOT_ELIGIBLE', 'This address is not on the airdrop list')

  const [claim] = await db.select({ txHash: claims.txHash }).from(claims)
    .where(and(eq(claims.projectAddress, address), eq(claims.claimKey, String(entry.index))))
  return json({
    index: entry.index,
    account: entry.account,
    amount: entry.amount,
    proof: entry.proof,
    claimed: !!claim,
    claimTx: claim?.txHash ?? null,
  })
})
