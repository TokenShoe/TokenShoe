/**
 * Sign-in & permissions
 *
 * Flow (Sign-In With Ethereum, EIP-4361):
 *  1. Frontend calls GET /api/auth/nonce to get a one-time nonce
 *  2. Frontend builds the message with viem's createSiweMessage and the wallet signs it (signMessage)
 *  3. POST /api/auth/login { message, signature } -> backend verifies and sets an HttpOnly cookie (24h)
 *  4. Protected routes then call requireSession / requireCreator
 *
 * Cookie format: base64url(JSON{addr,exp}).base64url(HMAC-SHA256) - no session table needed.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { env } from './env'
import { ApiError } from './http'
import { db } from '@/db/client'
import { projects, type Project } from '@/db/schema'

export const SESSION_COOKIE = 'tokendis_session'
export const SESSION_TTL_SECONDS = 24 * 3600

function hmac(data: string) {
  return createHmac('sha256', env.AUTH_SECRET).update(data).digest('base64url')
}

export function createSessionToken(address: string) {
  const payload = Buffer.from(
    JSON.stringify({ addr: address.toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString('base64url')
  return `${payload}.${hmac(payload)}`
}

/** Parse the cookie; returns null if the signature is invalid or it has expired */
export function readSession(req: NextRequest): { address: `0x${string}` } | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(hmac(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const { addr, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { addr: string; exp: number }
    if (exp < Date.now() / 1000) return null
    return { address: addr as `0x${string}` }
  } catch {
    return null
  }
}

export function requireSession(req: NextRequest) {
  const s = readSession(req)
  if (!s) throw new ApiError(401, 'UNAUTHORIZED', 'Please connect your wallet and sign in first')
  return s
}

/** Require the signed-in address to be the project's owner; returns the project */
export async function requireCreator(req: NextRequest, projectAddress: string): Promise<Project> {
  const s = requireSession(req)
  const project = await getProjectOr404(projectAddress)
  if (project.creator !== s.address) throw new ApiError(403, 'FORBIDDEN', 'Only the project creator can do this')
  return project
}

export async function getProjectOr404(projectAddress: string): Promise<Project> {
  const [project] = await db.select().from(projects).where(eq(projects.address, projectAddress.toLowerCase()))
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found (if you just created it, sync the creation transaction first)')
  return project
}
