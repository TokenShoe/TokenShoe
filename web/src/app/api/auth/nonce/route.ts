/** GET /api/auth/nonce -> { nonce }  Get a one-time nonce before signing in (valid for 10 minutes) */
import { generateSiweNonce } from 'viem/siwe'
import { lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { authNonces } from '@/db/schema'
import { json, route } from '@/lib/http'

export const dynamic = 'force-dynamic'

export const GET = route('auth.nonce', async () => {
  const nonce = generateSiweNonce()
  await db().insert(authNonces).values({ nonce })
  // Also clean up nonces older than 1 day
  await db().delete(authNonces).where(lt(authNonces.createdAt, new Date(Date.now() - 86400_000)))
  return json({ nonce })
})
