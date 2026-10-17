/**
 * Database connection (singleton). In dev, Next hot reload re-runs modules, so the pool is cached on globalThis to avoid leaking connections.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { env } from '@/lib/env'

type DB = NodePgDatabase<typeof schema>
const g = globalThis as unknown as { __tokendisPool?: Pool; __tokendisDb?: DB }

const pool = g.__tokendisPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 })
export const db: DB = g.__tokendisDb ?? drizzle(pool, { schema })

if (process.env.NODE_ENV !== 'production') {
  g.__tokendisPool = pool
  g.__tokendisDb = db
}

/** Transaction object type (the tx inside a db.transaction callback) */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
