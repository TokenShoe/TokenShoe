/**
 * Database connections - one Postgres database per network (Arc Testnet / Arc Mainnet), same schema in each.
 *
 *   db()            the current API request's network (see lib/request-network.ts)
 *   dbFor('mainnet') a specific network
 *
 * Pools are created lazily and cached. In dev, Next hot reload re-runs modules, so they are cached on globalThis
 * to avoid leaking connections.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/http'
import { NETWORKS, type NetworkKey } from '@/config/networks'
import { currentNetworkKey } from '@/lib/request-network'

type DB = NodePgDatabase<typeof schema>
const g = globalThis as unknown as { __tokendisDbs?: Partial<Record<NetworkKey, DB>> }
const cache = (g.__tokendisDbs ??= {})

const DATABASE_URLS: Record<NetworkKey, string | undefined> = {
  testnet: env.DATABASE_URL,
  mainnet: env.DATABASE_URL_MAINNET,
}

export function dbFor(key: NetworkKey): DB {
  const existing = cache[key]
  if (existing) return existing
  const url = DATABASE_URLS[key]
  if (!url) throw new ApiError(503, 'NETWORK_UNAVAILABLE', `TokenShoe is not available on ${NETWORKS[key].label} yet`)
  // Serverless runs many small instances, so keep each pool small (use a pooled connection string in production)
  const created = drizzle(new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10 }), { schema })
  cache[key] = created
  return created
}

/** Database of the current request's network */
export const db = (): DB => dbFor(currentNetworkKey())

/** Transaction object type (the tx inside a db().transaction callback) */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
