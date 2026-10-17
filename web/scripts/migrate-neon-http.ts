/**
 * Apply Drizzle migrations to a Neon database over HTTPS (port 443) instead of the Postgres port 5432.
 * Useful when a local proxy/firewall blocks 5432. Records progress in the same drizzle migrations table
 * as `drizzle-kit migrate`, so the two can be used interchangeably.
 *
 *   DATABASE_URL=postgres://...neon.tech/... bun scripts/migrate-neon-http.ts
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

const url = process.env.DATABASE_URL
if (!url || !/neon\.tech/.test(url)) {
  console.error('Set DATABASE_URL to a Neon connection string')
  process.exit(1)
}

const db = drizzle(neon(url))
console.log(`Migrating ${new URL(url).host} over HTTPS…`)
await migrate(db, { migrationsFolder: './src/db/migrations' })
const rows = await neon(url)`select count(*)::int as n from information_schema.tables where table_schema = 'public'`
console.log(`✓ Migrations applied (${rows[0].n} tables in public schema)`)
