/**
 * POST /api/auth/login  { message, signature } -> { address }, and sets the session cookie
 * message must be a standard SIWE message (the frontend builds it with createSiweMessage from viem/siwe).
 */
import { z } from 'zod'
import { and, eq, isNull, gt } from 'drizzle-orm'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { db } from '@/db/client'
import { authNonces } from '@/db/schema'
import { ApiError, json, parseBody, route } from '@/lib/http'
import { publicClient, chain } from '@/lib/chain'
import { allowedSignInDomains } from '@/lib/env'
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth'

const Body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
})

export const POST = route('auth.login', async (req) => {
  const { message, signature } = await parseBody(req, Body)
  const fields = parseSiweMessage(message)

  const domain = fields.domain?.toLowerCase()
  if (!domain || !allowedSignInDomains().has(domain) || !validateSiweMessage({ message: fields, domain }) || fields.chainId !== chain().id) {
    throw new ApiError(400, 'SIWE_INVALID', 'Invalid sign-in message (domain, chain or time mismatch)')
  }

  // The nonce must be one we issued, less than 10 minutes old and unused - mark it used atomically
  const used = await db()
    .update(authNonces)
    .set({ usedAt: new Date() })
    .where(and(
      eq(authNonces.nonce, fields.nonce!),
      isNull(authNonces.usedAt),
      gt(authNonces.createdAt, new Date(Date.now() - 10 * 60_000)),
    ))
    .returning()
  if (used.length === 0) throw new ApiError(400, 'NONCE_INVALID', 'Sign-in nonce is invalid or expired, please try again')

  // verifySiweMessage supports both regular wallets and contract wallets (ERC-1271, e.g. multisigs)
  const ok = await publicClient().verifySiweMessage({ message, signature: signature as `0x${string}` })
  if (!ok) throw new ApiError(401, 'BAD_SIGNATURE', 'Signature verification failed')

  const address = fields.address!.toLowerCase()
  const res = json({ address })
  res.cookies.set(SESSION_COOKIE, createSessionToken(address), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
})
