/**
 * GET /api/projects/:address/eligibility?account=0x...  - how much an address can claim in a project
 * Returns: EligibilityItem, or { eligible: false }
 */
import { z } from 'zod'
import { json, parseQuery, route, zAddress } from '@/lib/http'
import { getProjectOr404 } from '@/lib/auth'
import { eligibilityFor } from '@/lib/eligibility'

export const dynamic = 'force-dynamic'

export const GET = route<{ params: { address: string } }>('projects.eligibility', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  const { account } = parseQuery(req, z.object({ account: zAddress }))
  await getProjectOr404(address)
  const [item] = await eligibilityFor(account, address)
  return json(item ? { eligible: true, ...item } : { eligible: false })
})
