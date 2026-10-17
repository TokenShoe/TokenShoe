import type { Config } from 'drizzle-kit'
import { loadEnvConfig } from '@next/env'

// Load .env / .env.local the same way Next does
loadEnvConfig(process.cwd())

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
