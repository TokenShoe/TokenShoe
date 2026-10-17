/**
 * POST /api/projects/:address/sign/request  { account }  - ask the backend to sign before claiming a signature airdrop
 *
 * Returns: { account, amount, claimId, deadline, signature }
 * The frontend then calls claim(account, amount, claimId, deadline, signature) and submits the tx to /api/tx once it succeeds.
 *
 * No sign-in needed: the signature is bound to account, so tokens only ever go to that address even if someone else submits it.
 *
 * Error codes:
 *   NOT_ELIGIBLE        not on the list
 *   NOTHING_TO_CLAIM    allocation fully claimed
 *   NOT_IN_WINDOW       outside the claim window / project paused
 *   SIGNER_NOT_READY    the backend has no signer key matching the on-chain signer (the creator must provide it)
 *   CLAIM_PENDING_SYNC  the previous claim is on-chain but not synced yet; submit that transaction to /api/tx first
 */
import { z } from 'zod'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Address, Hex } from 'viem'
import { db } from '@/db/client'
import { signAllocations, signIssuances, signSigners } from '@/db/schema'
import { ApiError, json, parseBody, route, zAddress } from '@/lib/http'
import { getProjectOr404 } from '@/lib/auth'
import { projectStatus } from '@/lib/views'
import { computeClaimId, signClaim } from '@/lib/sign'
import { decryptPrivKey } from '@/lib/crypto'
import { publicClient } from '@/lib/chain'
import { AIRDROP_READ_ABI } from '@/lib/abis'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** If an existing signature has less than this many seconds left, issue a new one so the user has time to send the tx */
const REUSE_MIN_REMAINING = 300

const Body = z.object({ account: zAddress })

export const POST = route<{ params: { address: string } }>('sign.request', async (req, { params }) => {
  const projectAddress = zAddress.parse(params.address)
  const { account } = await parseBody(req, Body)
  const project = await getProjectOr404(projectAddress)
  if (project.type !== 'sign') throw new ApiError(400, 'WRONG_TYPE', 'This project is not a signature airdrop')

  const status = projectStatus(project)
  if (status !== 'active') {
    const msg = { upcoming: 'Claiming has not started yet', paused: 'This project is paused', ended: 'Claiming has ended' }[status]
    throw new ApiError(400, 'NOT_IN_WINDOW', msg)
  }

  const [alloc] = await db().select().from(signAllocations)
    .where(and(eq(signAllocations.projectAddress, projectAddress), eq(signAllocations.account, account)))
  if (!alloc || BigInt(alloc.amount) === 0n) throw new ApiError(403, 'NOT_ELIGIBLE', 'This address is not on the airdrop list')
  const claimable = BigInt(alloc.amount) - BigInt(alloc.claimed)
  if (claimable <= 0n) throw new ApiError(409, 'NOTHING_TO_CLAIM', 'Everything has already been claimed')

  const [signer] = await db().select().from(signSigners).where(eq(signSigners.projectAddress, projectAddress))
  if (!signer || signer.signerAddress !== project.signerAddress) {
    throw new ApiError(503, 'SIGNER_NOT_READY', 'The project has not configured its signer key yet, claiming is unavailable')
  }

  const claimId = computeClaimId(projectAddress, account, alloc.claimNonce)

  // This claimId is already used on-chain: the previous claim succeeded but was not synced - don't sign again or the books won't balance
  const used = await publicClient().readContract({
    address: projectAddress, abi: AIRDROP_READ_ABI, functionName: 'usedClaimIds', args: [claimId],
  })
  if (used) {
    throw new ApiError(409, 'CLAIM_PENDING_SYNC', 'Your previous claim is on-chain but not synced yet. Please sync that claim transaction first', { claimId })
  }

  const now = Math.floor(Date.now() / 1000)

  // Reuse a still-valid signature for the same amount
  const [existing] = await db().select().from(signIssuances)
    .where(and(
      eq(signIssuances.projectAddress, projectAddress),
      eq(signIssuances.claimId, claimId),
      eq(signIssuances.amount, claimable.toString()),
      gt(signIssuances.deadline, now + REUSE_MIN_REMAINING),
      isNull(signIssuances.usedTx),
    ))
    .orderBy(desc(signIssuances.deadline))
    .limit(1)
  if (existing) {
    return json({ account, amount: existing.amount, claimId, deadline: String(existing.deadline), signature: existing.signature })
  }

  const deadline = now + env.SIGN_TTL_SECONDS
  const signature = await signClaim({
    privateKey: decryptPrivKey(signer.encryptedPrivKey) as Hex,
    project: projectAddress as Address,
    account,
    amount: claimable,
    claimId,
    deadline: BigInt(deadline),
  })
  await db().insert(signIssuances).values({
    projectAddress, account, claimId, nonce: alloc.claimNonce, amount: claimable.toString(), deadline, signature,
  })

  log.info('sign.issued', { project: projectAddress, account, nonce: alloc.claimNonce, amount: claimable.toString() })
  return json({ account, amount: claimable.toString(), claimId, deadline: String(deadline), signature })
})
