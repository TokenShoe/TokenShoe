/**
 * GET /api/accounts/:account/claimable  - what this address can claim across all projects (main view of the Claim page)
 * Returns: { items: EligibilityItem[] }, claimable items first. See lib/eligibility.ts
 */
import { json, route, zAddress } from '@/lib/http'
import { eligibilityFor } from '@/lib/eligibility'

export const dynamic = 'force-dynamic'

export const GET = route<{ params: { account: string } }>('accounts.claimable', async (_req, { params }) => {
  const account = zAddress.parse(params.account)
  return json({ items: await eligibilityFor(account) })
})
