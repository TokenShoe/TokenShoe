/**
 * POST /api/tx  - sync an on-chain transaction (the frontend calls this after every transaction)
 *
 * Body:
 *   txHash            required, transaction hash
 *   meta              optional, display info when creating a project { name, description, logoUrl, website, twitter, telegram }
 *   signerPrivateKey  optional, signer key submitted when creating a signature airdrop
 *
 * Returns: { status, txHash, blockNumber, events, projectsCreated, warnings }
 *   status = processed | already_processed | no_relevant_events
 * Submitting the same transaction more than once is safe.
 */
import { z } from 'zod'
import { ApiError, json, parseBody, route, zTxHash } from '@/lib/http'
import { processTx } from '@/lib/tx-processor'
import { zProjectMeta } from '@/lib/http'
import { normalizePrivateKey } from '@/lib/sign'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby caps functions at 60s

const Body = z.object({
  txHash: zTxHash,
  meta: zProjectMeta.optional(),
  signerPrivateKey: z.string().optional(),
})

export const POST = route('tx.process', async (req) => {
  const body = await parseBody(req, Body)
  let key: `0x${string}` | undefined
  if (body.signerPrivateKey) {
    const k = normalizePrivateKey(body.signerPrivateKey)
    if (!k) throw new ApiError(400, 'BAD_PRIVATE_KEY', 'Invalid signer private key (expected 64 hex characters)')
    key = k
  }
  const result = await processTx(body.txHash, { meta: body.meta, signerPrivateKey: key })
  return json(result)
})
