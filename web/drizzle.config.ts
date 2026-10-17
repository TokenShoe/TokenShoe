import type { Config } from 'drizzle-kit'
import { loadEnvConfig } from '@next/env'

// Load .env / .env.local the same way Next does
loadEnvConfig(process.cwd())

// One database per network: DRIZZLE_NETWORK=mainnet targets DATABASE_URL_MAINNET, otherwise DATABASE_URL (testnet)
const mainnet = process.env.DRIZZLE_NETWORK === 'mainnet'
const url = mainnet ? process.env.DATABASE_URL_MAINNET : process.env.DATABASE_URL
if (!url) throw new Error(`${mainnet ? 'DATABASE_URL_MAINNET' : 'DATABASE_URL'} is not set`)

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config
