/**
 * TokenShoe database schema (Postgres + Drizzle)
 *
 * Design principles:
 *  - No on-chain indexer. After every transaction the frontend sends the txHash to POST /api/tx;
 *    the backend reads the receipt, decodes the events and writes the DB itself - data always comes from on-chain events and cannot be forged by the frontend.
 *  - All addresses are stored lowercase.
 *  - All token amounts are stored in base units (wei) as numeric(78,0): fits any uint256 and can be summed directly in SQL.
 */
import {
  pgTable, pgEnum,
  text, varchar, integer, bigint, boolean, numeric, date,
  timestamp, jsonb, primaryKey, unique, index,
} from 'drizzle-orm/pg-core'

/** uint256 amount column (drizzle reads it back as string) */
const amount = (name: string) => numeric(name, { precision: 78, scale: 0 })
/** Address column */
const address = (name: string) => varchar(name, { length: 42 })
/** Transaction hash / bytes32 column */
const bytes32 = (name: string) => varchar(name, { length: 66 })

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Maps 1:1 to the factory implType: 0 merkle / 1 sign / 2 vesting */
export const projectTypeEnum = pgEnum('project_type', ['merkle', 'sign', 'vesting'])

/** Action types in the project activity log */
export const activityKindEnum = pgEnum('activity_kind', [
  'created', 'funded', 'withdrawn', 'paused', 'unpaused',
  'root_updated', 'signer_updated', 'schedule_created', 'schedule_revoked',
  'creator_transfer_initiated', 'creator_transferred',
])

// ─── Sign-in (Sign-In With Ethereum) ─────────────────────────────────────────

/** One-time nonces for sign-in, preventing signature replay */
export const authNonces = pgTable('auth_nonces', {
  nonce:     varchar('nonce', { length: 128 }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  usedAt:    timestamp('used_at', { withTimezone: true }),
})

// ─── Projects ────────────────────────────────────────────────────────────────

export const projects = pgTable('projects', {
  address:        address('address').primaryKey(),          // project contract (clone proxy) address
  type:           projectTypeEnum('type').notNull(),
  creator:        address('creator').notNull(),              // current owner (updated on CreatorTransferred)
  pendingCreator: address('pending_creator'),

  // Token
  tokenAddress:   address('token_address').notNull(),
  tokenSymbol:    varchar('token_symbol', { length: 32 }),
  tokenName:      varchar('token_name', { length: 120 }),
  tokenDecimals:  integer('token_decimals').notNull().default(18),

  // Funds (kept in sync with on-chain totalFunded / totalClaimed)
  totalFunded:    amount('total_funded').notNull().default('0'),
  totalClaimed:   amount('total_claimed').notNull().default('0'),
  totalWithdrawn: amount('total_withdrawn').notNull().default('0'),

  // Claim window for airdrops (merkle / sign), unix seconds; null for vesting
  startTime:      bigint('start_time', { mode: 'number' }),
  endTime:        bigint('end_time', { mode: 'number' }),
  // Pause state (mirrors the contract's effectiveEndTime calculation)
  paused:              boolean('paused').notNull().default(false),
  pausedSince:         bigint('paused_since', { mode: 'number' }),
  totalPausedDuration: bigint('total_paused_duration', { mode: 'number' }).notNull().default(0),

  // Type-specific
  merkleRoot:     bytes32('merkle_root'),                    // merkle: currently active root
  signerAddress:  address('signer_address'),                 // sign: on-chain signer

  // Display info (entered by the creator)
  name:           varchar('name', { length: 120 }).notNull(),
  description:    text('description'),
  logoUrl:        varchar('logo_url', { length: 300 }),
  website:        varchar('website', { length: 200 }),
  twitter:        varchar('twitter', { length: 80 }),
  telegram:       varchar('telegram', { length: 80 }),

  // On-chain origin
  createdTx:      bytes32('created_tx').notNull(),
  createdBlock:   bigint('created_block', { mode: 'number' }).notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull(),   // block time
  updatedAt:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_projects_creator').on(t.creator),
  index('idx_projects_type').on(t.type),
  index('idx_projects_created_at').on(t.createdAt),
  index('idx_projects_merkle_root').on(t.merkleRoot),
])

// ─── Merkle lists ────────────────────────────────────────────────────────────

/**
 * One Merkle tree (= one uploaded CSV). Keyed by root: the same list always yields the same root, so it is deduplicated naturally.
 * Projects point to it via projects.merkle_root; after setRoot the project points to the new tree.
 */
export const merkleTrees = pgTable('merkle_trees', {
  root:          bytes32('root').primaryKey(),
  totalEntries:  integer('total_entries').notNull(),
  totalAmount:   amount('total_amount').notNull(),
  tokenDecimals: integer('token_decimals').notNull(),
  uploader:      address('uploader').notNull(),
  fileName:      varchar('file_name', { length: 200 }),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Merkle leaves: one row per CSV line, with the proof precomputed so claims can return it directly */
export const merkleEntries = pgTable('merkle_entries', {
  root:    bytes32('root').notNull(),
  index:   integer('index').notNull(),        // leaf index (the index argument of the contract's claim)
  account: address('account').notNull(),
  amount:  amount('amount').notNull(),
  proof:   jsonb('proof').notNull().$type<string[]>(),
}, (t) => [
  primaryKey({ columns: [t.root, t.index] }),
  unique('uniq_merkle_root_account').on(t.root, t.account),
])

// ─── Signature airdrops ──────────────────────────────────────────────────────

/** Signer private key provided by the creator (AES-256-GCM encrypted; used only for signing; must be a fresh, empty account) */
export const signSigners = pgTable('sign_signers', {
  projectAddress:   address('project_address').primaryKey(),
  signerAddress:    address('signer_address').notNull(),
  encryptedPrivKey: text('encrypted_priv_key').notNull(),      // iv:authTag:ciphertext
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Signature airdrop allocations; the creator can add, edit or remove them at any time.
 *  amount     = total this address can claim (set by the creator)
 *  claimed    = amount already claimed on-chain (accumulated from Claimed events)
 *  claimNonce = number of successful claims, used to derive the next claimId
 * Claimable = amount - claimed. If the creator raises someone's allocation, they can claim the difference.
 */
export const signAllocations = pgTable('sign_allocations', {
  projectAddress: address('project_address').notNull(),
  account:        address('account').notNull(),
  amount:         amount('amount').notNull(),
  claimed:        amount('claimed').notNull().default('0'),
  claimNonce:     integer('claim_nonce').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectAddress, t.account] }),
  index('idx_sign_alloc_account').on(t.account),
])

/** Every signature the backend has issued (audit trail + reuse while still valid to avoid re-issuing) */
export const signIssuances = pgTable('sign_issuances', {
  id:             integer('id').primaryKey().generatedAlwaysAsIdentity(),
  projectAddress: address('project_address').notNull(),
  account:        address('account').notNull(),
  claimId:        bytes32('claim_id').notNull(),
  nonce:          integer('nonce').notNull(),
  amount:         amount('amount').notNull(),
  deadline:       bigint('deadline', { mode: 'number' }).notNull(),
  signature:      text('signature').notNull(),
  usedTx:         bytes32('used_tx'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_sign_iss_claim').on(t.projectAddress, t.claimId),
])

// ─── Vesting ─────────────────────────────────────────────────────────────────

/** Mirror of the on-chain Schedule (maintained from ScheduleCreated / ScheduleRevoked / Claimed events) */
export const vestingSchedules = pgTable('vesting_schedules', {
  projectAddress:      address('project_address').notNull(),
  scheduleId:          integer('schedule_id').notNull(),
  beneficiary:         address('beneficiary').notNull(),
  totalAmount:         amount('total_amount').notNull(),
  claimed:             amount('claimed').notNull().default('0'),
  tgeTime:             bigint('tge_time', { mode: 'number' }).notNull(),
  tgeBps:              integer('tge_bps').notNull(),
  cliffDuration:       bigint('cliff_duration', { mode: 'number' }).notNull(),     // seconds
  vestingDuration:     bigint('vesting_duration', { mode: 'number' }).notNull(),   // seconds
  interval:            bigint('interval', { mode: 'number' }).notNull(),           // seconds, 0 = continuous
  revocable:           boolean('revocable').notNull(),
  revoked:             boolean('revoked').notNull().default(false),
  revokedClaimableCap: amount('revoked_claimable_cap').notNull().default('0'),
  createdTx:           bytes32('created_tx').notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectAddress, t.scheduleId] }),
  index('idx_vesting_beneficiary').on(t.beneficiary),
])

// ─── Claims & activity log ───────────────────────────────────────────────────

/** One row per on-chain Claimed event (all three types) */
export const claims = pgTable('claims', {
  id:             integer('id').primaryKey().generatedAlwaysAsIdentity(),
  projectAddress: address('project_address').notNull(),
  type:           projectTypeEnum('type').notNull(),
  account:        address('account').notNull(),
  amount:         amount('amount').notNull(),
  // merkle -> leaf index; sign -> claimId (0x...); vesting -> scheduleId
  claimKey:       text('claim_key').notNull(),
  txHash:         bytes32('tx_hash').notNull(),
  logIndex:       integer('log_index').notNull(),
  blockNumber:    bigint('block_number', { mode: 'number' }).notNull(),
  claimedAt:      timestamp('claimed_at', { withTimezone: true }).notNull(),   // block time
}, (t) => [
  unique('uniq_claim_log').on(t.txHash, t.logIndex),
  index('idx_claims_project').on(t.projectAddress, t.claimedAt),
  index('idx_claims_account').on(t.account, t.claimedAt),
  index('idx_claims_project_key').on(t.projectAddress, t.claimKey),
])

/** Non-claim project events (fund, withdraw, pause, set root, set signer ...) for the project page timeline */
export const projectActivities = pgTable('project_activities', {
  id:             integer('id').primaryKey().generatedAlwaysAsIdentity(),
  projectAddress: address('project_address').notNull(),
  kind:           activityKindEnum('kind').notNull(),
  actor:          address('actor'),                         // tx sender / subject of the event
  amount:         amount('amount'),
  data:           jsonb('data').$type<Record<string, unknown>>(),
  txHash:         bytes32('tx_hash').notNull(),
  logIndex:       integer('log_index').notNull(),
  at:             timestamp('at', { withTimezone: true }).notNull(),
}, (t) => [
  unique('uniq_activity_log').on(t.txHash, t.logIndex),
  index('idx_activity_project').on(t.projectAddress, t.at),
])

/** Processed transactions (idempotency: resubmitting the same tx is processed only once) */
export const processedTxs = pgTable('processed_txs', {
  txHash:      bytes32('tx_hash').primaryKey(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  from:        address('from').notNull(),
  eventCount:  integer('event_count').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
})

// ─── Stats ───────────────────────────────────────────────────────────────────

/** Platform-wide stats (single row, id = 1), incremented in the same DB transaction that processes a tx, so they stay exact */
export const platformStats = pgTable('platform_stats', {
  id:              integer('id').primaryKey().default(1),
  totalProjects:   integer('total_projects').notNull().default(0),
  totalMerkle:     integer('total_merkle').notNull().default(0),
  totalSign:       integer('total_sign').notNull().default(0),
  totalVesting:    integer('total_vesting').notNull().default(0),
  totalCreators:   integer('total_creators').notNull().default(0),   // distinct addresses that created a project
  totalClaims:     integer('total_claims').notNull().default(0),     // number of claims
  totalClaimers:   integer('total_claimers').notNull().default(0),   // distinct addresses that claimed
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Per-project stats */
export const projectStats = pgTable('project_stats', {
  projectAddress: address('project_address').primaryKey(),
  recipients:     integer('recipients').notNull().default(0),    // number of recipients
  claimCount:     integer('claim_count').notNull().default(0),   // number of claims
  claimerCount:   integer('claimer_count').notNull().default(0), // distinct addresses that claimed
  updatedAt:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Daily stats (UTC) for the frontend trend chart */
export const dailyStats = pgTable('daily_stats', {
  day:             date('day').primaryKey(),
  projectsCreated: integer('projects_created').notNull().default(0),
  claims:          integer('claims').notNull().default(0),
  newClaimers:     integer('new_claimers').notNull().default(0),
})

/** Dedup helper: addresses that have ever claimed (for totalClaimers / newClaimers) */
export const claimers = pgTable('claimers', {
  account:      address('account').primaryKey(),
  firstClaimAt: timestamp('first_claim_at', { withTimezone: true }).notNull(),
})

/** Dedup helper: addresses that claimed in a given project (for project_stats.claimer_count) */
export const projectClaimers = pgTable('project_claimers', {
  projectAddress: address('project_address').notNull(),
  account:        address('account').notNull(),
}, (t) => [primaryKey({ columns: [t.projectAddress, t.account] })])

/** Dedup helper: addresses that created a project (for totalCreators) */
export const creators = pgTable('creators', {
  account:        address('account').primaryKey(),
  firstProjectAt: timestamp('first_project_at', { withTimezone: true }).notNull(),
})

export type Project = typeof projects.$inferSelect
export type ProjectType = (typeof projectTypeEnum.enumValues)[number]
export const IMPL_TYPE_TO_PROJECT_TYPE: Record<number, ProjectType> = { 0: 'merkle', 1: 'sign', 2: 'vesting' }
