/**
 * Server environment variables (validated at startup so a missing value fails loudly instead of crashing mid-request).
 * Only import this from server-side code.
 */
import { z } from 'zod'

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

const schema = z.object({
  // One database per network. DATABASE_URL = Arc Testnet; DATABASE_URL_MAINNET = Arc Mainnet
  // (optional until mainnet goes live - mainnet API calls answer 503 NETWORK_UNAVAILABLE without it)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is not set (Postgres connection string)'),
  DATABASE_URL_MAINNET: z.string().min(1).optional(),
  // Master key used to encrypt signer private keys: 32 bytes = 64 hex characters. Generate with: openssl rand -hex 32
  SIGN_KEY_SECRET: z.string().regex(/^[0-9a-fA-F]{64}$/, 'SIGN_KEY_SECRET must be 64 hex characters'),
  // Secret for signing the session cookie; any random string of 32+ characters. Generate with: openssl rand -hex 32
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  // Chain config (chain ids, public RPCs, contract addresses) lives in config/networks.ts.
  // Optional private server-side RPCs (more reliable, no rate limits); fall back to the public ones
  RPC_URL: z.string().url().optional(),
  MAINNET_RPC_URL: z.string().url().optional(),
  // Optional overrides of the implementation addresses in config/networks.ts (used to recognise clones of our factory)
  MERKLE_IMPL: zAddr.optional(),
  SIGN_IMPL: zAddr.optional(),
  VESTING_IMPL: zAddr.optional(),
  MAINNET_MERKLE_IMPL: zAddr.optional(),
  MAINNET_SIGN_IMPL: zAddr.optional(),
  MAINNET_VESTING_IMPL: zAddr.optional(),

  // Signature airdrop: validity of each issued signature (seconds)
  SIGN_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
  // Domain(s) allowed in the SIWE sign-in message, comma-separated, e.g. localhost:3000,tokenshoe.xyz
  // On Vercel the deployment's own domains are allowed automatically (see allowedSignInDomains)
  APP_DOMAIN: z.string().default('localhost:3000'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Invalid environment configuration:\n${msg}`)
}

export const env = parsed.data

/** Domains accepted in SIWE messages: APP_DOMAIN entries + the current Vercel deployment / branch / production domains */
export function allowedSignInDomains(): Set<string> {
  const list = env.APP_DOMAIN.split(',').map((d) => d.trim()).filter(Boolean)
  for (const v of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (v) list.push(v)
  }
  return new Set(list.map((d) => d.toLowerCase()))
}
