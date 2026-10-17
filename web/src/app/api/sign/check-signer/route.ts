/**
 * GET /api/sign/check-signer?address=0x...  - before creating a signature airdrop, check the signer account is brand new and empty
 * Returns: { address, fresh: true } or { address, fresh: false, reason }
 * Needs only the address, never the private key.
 */
import { z } from 'zod'
import { json, parseQuery, route, zAddress } from '@/lib/http'
import { checkFreshAccount } from '@/lib/tx-processor'

export const dynamic = 'force-dynamic'

export const GET = route('sign.check_signer', async (req) => {
  const { address } = parseQuery(req, z.object({ address: zAddress }))
  return json({ address, ...(await checkFreshAccount(address)) })
})
