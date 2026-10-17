/** GET /api/auth/me -> { address } | { address: null }  The currently signed-in address */
import { json, route } from '@/lib/http'
import { readSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const GET = route('auth.me', async (req) => json({ address: readSession(req)?.address ?? null }))
