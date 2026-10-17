/**
 * POST /api/projects/:address/sign/signer  { privateKey }  - register / replace the signer key (project creator only)
 *
 * Requirements:
 *  - the key's address must equal the contract's current signer (to rotate: call setSigner(newAddress) on-chain, sync that tx, then call this)
 *  - it must be a brand-new account: never sent a transaction and holds no native balance
 * The key is stored AES-256-GCM encrypted and used by the backend only for off-chain signing.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects, signSigners } from '@/db/schema'
import { ApiError, json, parseBody, route, zAddress } from '@/lib/http'
import { requireCreator } from '@/lib/auth'
import { normalizePrivateKey } from '@/lib/sign'
import { checkSignerKey } from '@/lib/tx-processor'
import { encryptPrivKey } from '@/lib/crypto'
import { publicClient } from '@/lib/chain'
import { AIRDROP_READ_ABI } from '@/lib/abis'
import { privateKeyToAccount } from 'viem/accounts'
import { log } from '@/lib/logger'

const Body = z.object({ privateKey: z.string() })

export const POST = route<{ params: { address: string } }>('sign.signer', async (req, { params }) => {
  const project = await requireCreator(req, zAddress.parse(params.address))
  if (project.type !== 'sign') throw new ApiError(400, 'WRONG_TYPE', 'This project is not a signature airdrop')

  const key = normalizePrivateKey((await parseBody(req, Body)).privateKey)
  if (!key) throw new ApiError(400, 'BAD_PRIVATE_KEY', 'Invalid private key (expected 64 hex characters)')

  // Trust the chain (the DB signer may not be synced yet)
  const onChainSigner = (await publicClient().readContract({
    address: project.address as `0x${string}`, abi: AIRDROP_READ_ABI, functionName: 'signer',
  })).toLowerCase() as `0x${string}`

  const problem = await checkSignerKey(key, onChainSigner)
  if (problem) throw new ApiError(400, 'SIGNER_KEY_REJECTED', problem)

  const signerAddress = privateKeyToAccount(key).address.toLowerCase()
  const encrypted = encryptPrivKey(key)
  await db().transaction(async (tx) => {
    await tx.insert(signSigners).values({ projectAddress: project.address, signerAddress, encryptedPrivKey: encrypted })
      .onConflictDoUpdate({ target: signSigners.projectAddress, set: { signerAddress, encryptedPrivKey: encrypted, updatedAt: new Date() } })
    await tx.update(projects).set({ signerAddress, updatedAt: new Date() }).where(eq(projects.address, project.address))
  })
  log.info('sign.signer_registered', { project: project.address, signer: signerAddress })
  return json({ signerAddress })
})
