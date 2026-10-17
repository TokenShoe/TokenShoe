/**
 * Server environment variables (validated at startup so a missing value fails loudly instead of crashing mid-request).
 * Only import this from server-side code.
 */
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is not set (Postgres connection string)'),
  // Master key used to encrypt signer private keys: 32 bytes = 64 hex characters. Generate with: openssl rand -hex 32
  SIGN_KEY_SECRET: z.string().regex(/^[0-9a-fA-F]{64}$/, 'SIGN_KEY_SECRET must be 64 hex characters'),
  // Secret for signing the session cookie; any random string of 32+ characters. Generate with: openssl rand -hex 32
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  // Chain config: chain id / public RPC / factory address are shared with the frontend via NEXT_PUBLIC_* (see config/chain.ts)
  // RPC_URL is optional: a private server-side RPC (more reliable, no rate limits); falls back to NEXT_PUBLIC_RPC_URL
  RPC_URL: z.string().url().optional(),
  // The three implementation addresses (server only; used to recognise clones created by our factory)
  MERKLE_IMPL: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0xAc68198e66f46920125D48fAfA978c5067cE4B15'),
  SIGN_IMPL: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0x17968730099016e6679911Ad62603e337d3dcc75'),
  VESTING_IMPL: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0xC4e6Da6235190422E6BC4d3D7a1E0DEd412E3877'),

  // Signature airdrop: validity of each issued signature (seconds)
  SIGN_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
  // Domain in the SIWE sign-in message (must match the domain the frontend is served from), e.g. localhost:3000
  APP_DOMAIN: z.string().default('localhost:3000'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Invalid environment configuration:\n${msg}`)
}

export const env = parsed.data
