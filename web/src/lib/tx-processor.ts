/**
 * Transaction processor - the single data entry point of the backend.
 *
 * Whenever the frontend completes an on-chain transaction (create project / claim / fund / withdraw / pause / set root / set signer / add schedules / revoke ...),
 * it calls POST /api/tx { txHash }. This module then:
 *   1. Fetches the transaction receipt from the chain (it must have succeeded)
 *   2. Decodes the events emitted by our factory and our projects
 *   3. Reads any extra data it needs (project parameters, vesting schedule details) from the contracts via RPC
 *   4. Writes all changes plus stats counters in a single DB transaction; processed_txs guarantees each tx is processed once
 *
 * Because all data comes from on-chain events, the frontend cannot inject fake data.
 */
import {
  decodeEventLog, toEventSelector, getAbiItem, pad, toHex,
  type Address, type Hex, type Log, type TransactionReceipt,
  TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, type Tx } from '@/db/client'
import {
  projects, processedTxs, claims, projectActivities, signAllocations, signIssuances,
  signSigners, vestingSchedules, merkleTrees, IMPL_TYPE_TO_PROJECT_TYPE, type ProjectType,
} from '@/db/schema'
import { FACTORY_ABI, PROJECT_EVENTS_ABI, AIRDROP_READ_ABI, VESTING_READ_ABI } from './abis'
import { publicClient, CONTRACTS, readTokenInfo, detectCloneImpl } from './chain'
import { ApiError } from './http'
import { log } from './logger'
import { encryptPrivKey } from './crypto'
import { onProjectCreated, onClaim, onCreatorChanged, refreshRecipients } from './stats'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  name?: string
  description?: string
  logoUrl?: string
  website?: string
  twitter?: string
  telegram?: string
}

export interface ProcessTxOptions {
  /** Display info submitted together with project creation */
  meta?: ProjectMeta
  /** Signer private key submitted when creating a signature airdrop (must match the on-chain signer and be a fresh, empty account) */
  signerPrivateKey?: Hex
}

export interface ProcessTxResult {
  status: 'processed' | 'already_processed' | 'no_relevant_events'
  txHash: Hex
  blockNumber: number
  events: { project: Address; event: string }[]
  projectsCreated: Address[]
  /** Non-fatal issues (e.g. Merkle list not uploaded, signer key rejected) that the frontend should show to the user */
  warnings: { code: string; message: string; project?: Address }[]
}

type ProjectEvent = ReturnType<typeof decodeEventLog<typeof PROJECT_EVENTS_ABI>>

interface DecodedProjectLog {
  project: Address
  logIndex: number
  event: ProjectEvent
}

interface NewProjectInfo {
  address: Address
  type: ProjectType
  creator: Address
  token: Address
  logIndex: number
  tokenInfo: Awaited<ReturnType<typeof readTokenInfo>>
  startTime: number | null
  endTime: number | null
  merkleRoot: Hex | null
  signer: Address | null
}

type ScheduleOnChain = Awaited<ReturnType<typeof readSchedule>>

// topic0 of the project events we care about; used to spot "looks like our project but is missing from the DB"
const PROJECT_TOPICS = new Set(
  PROJECT_EVENTS_ABI.filter((x) => x.type === 'event').map((e) => toEventSelector(e).toLowerCase()),
)
const PROJECT_CREATED_TOPIC = toEventSelector(getAbiItem({ abi: FACTORY_ABI, name: 'ProjectCreated' })).toLowerCase()

const lower = (a: string) => a.toLowerCase() as Address

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function processTx(txHash: Hex, opts: ProcessTxOptions = {}): Promise<ProcessTxResult> {
  const hash = lower(txHash) as Hex
  const warnings: ProcessTxResult['warnings'] = []

  // 0. Already processed -> return immediately (idempotent)
  const [done] = await db.select().from(processedTxs).where(eq(processedTxs.txHash, hash))
  if (done) {
    return { status: 'already_processed', txHash: hash, blockNumber: done.blockNumber, events: [], projectsCreated: [], warnings }
  }

  // 1. Fetch the receipt (the frontend may call right after sending, so wait up to 60 seconds)
  const receipt = await getReceipt(hash)
  if (receipt.status !== 'success') throw new ApiError(400, 'TX_REVERTED', 'Transaction reverted, nothing to sync')
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
  const at = new Date(Number(block.timestamp) * 1000)
  const blockTs = Number(block.timestamp)

  // 2a. Factory events: projects created in this transaction
  const newProjects: NewProjectInfo[] = []
  for (const l of receipt.logs) {
    if (lower(l.address) !== CONTRACTS.factory || l.topics[0]?.toLowerCase() !== PROJECT_CREATED_TOPIC) continue
    const ev = decodeEventLog({ abi: FACTORY_ABI, data: l.data, topics: l.topics })
    const type = IMPL_TYPE_TO_PROJECT_TYPE[ev.args.implType]
    if (!type) {
      warnings.push({ code: 'UNKNOWN_IMPL_TYPE', message: `Unknown project type ${ev.args.implType}, ignored` })
      continue
    }
    newProjects.push(await readNewProject(lower(ev.args.proxy), type, lower(ev.args.creator), lower(ev.args.token), l.logIndex))
  }

  // 2b. Project events: emitted by projects created in this tx or already in the DB
  const newSet = new Set(newProjects.map((p) => p.address))
  const candidateLogs = receipt.logs.filter((l) => PROJECT_TOPICS.has(l.topics[0]?.toLowerCase() ?? ''))
  const emitters = [...new Set(candidateLogs.map((l) => lower(l.address)))].filter((a) => !newSet.has(a))
  const known = emitters.length
    ? await db.select({ address: projects.address, type: projects.type }).from(projects).where(inArray(projects.address, emitters))
    : []
  const typeOf = new Map<Address, ProjectType>([
    ...newProjects.map((p) => [p.address, p.type] as const),
    ...known.map((p) => [p.address as Address, p.type] as const),
  ])

  // Not in the DB, but the bytecode proves it is a clone from our factory -> its creation tx is not synced yet; don't drop events
  for (const addr of emitters) {
    if (typeOf.has(addr)) continue
    if (await detectCloneImpl(addr)) {
      throw new ApiError(409, 'PROJECT_NOT_SYNCED', `Project ${addr} is not synced yet. Sync its creation transaction first`, { project: addr })
    }
  }

  const decoded: DecodedProjectLog[] = []
  for (const l of candidateLogs) {
    const project = lower(l.address)
    if (!typeOf.has(project)) continue
    const ev = safeDecode(l)
    if (ev) decoded.push({ project, logIndex: l.logIndex, event: ev })
  }
  decoded.sort((a, b) => a.logIndex - b.logIndex)

  if (newProjects.length === 0 && decoded.length === 0) {
    return { status: 'no_relevant_events', txHash: hash, blockNumber: Number(receipt.blockNumber), events: [], projectsCreated: [], warnings }
  }

  // 3. Full vesting schedule parameters must be read from the contract (the event only has id / beneficiary / total)
  const schedules = new Map<string, ScheduleOnChain>()
  for (const d of decoded) {
    if (d.event.eventName === 'ScheduleCreated' || d.event.eventName === 'ScheduleRevoked') {
      const id = d.event.args.id
      schedules.set(`${d.project}:${id}`, await readSchedule(d.project, id))
    }
  }

  // 3b. Validate the signer key (must match the on-chain signer and be a fresh account with no funds or transactions)
  const signerKeys = new Map<Address, { signerAddress: Address; encrypted: string }>()
  for (const p of newProjects.filter((x) => x.type === 'sign')) {
    if (!opts.signerPrivateKey) {
      warnings.push({ code: 'SIGNER_KEY_MISSING', project: p.address, message: 'No signer key was submitted, so users cannot claim yet. Add it in project settings.' })
      continue
    }
    const problem = await checkSignerKey(opts.signerPrivateKey, p.signer!)
    if (problem) warnings.push({ code: 'SIGNER_KEY_REJECTED', project: p.address, message: problem })
    else signerKeys.set(p.address, { signerAddress: p.signer!, encrypted: encryptPrivKey(opts.signerPrivateKey) })
  }

  // 4. Write everything in one transaction
  const events: ProcessTxResult['events'] = []
  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx.insert(processedTxs).values({
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      from: lower(receipt.from),
      eventCount: newProjects.length + decoded.length,
    }).onConflictDoNothing().returning()
    // Another concurrent request already processed it
    if (inserted.length === 0) return 'already_processed' as const

    for (const p of newProjects) {
      await insertProject(tx, p, hash, receipt, at, opts.meta)
      const key = signerKeys.get(p.address)
      if (key) {
        await tx.insert(signSigners)
          .values({ projectAddress: p.address, signerAddress: key.signerAddress, encryptedPrivKey: key.encrypted })
          .onConflictDoUpdate({
            target: signSigners.projectAddress,
            set: { signerAddress: key.signerAddress, encryptedPrivKey: key.encrypted, updatedAt: new Date() },
          })
      }
      if (p.type === 'merkle' && p.merkleRoot) {
        const [tree] = await tx.select({ root: merkleTrees.root }).from(merkleTrees).where(eq(merkleTrees.root, p.merkleRoot))
        if (!tree) warnings.push({ code: 'MERKLE_TREE_NOT_UPLOADED', project: p.address, message: 'The on-chain Merkle root has no matching list on the server, so users cannot get proofs. Upload the same CSV again.' })
      }
      events.push({ project: p.address, event: 'ProjectCreated' })
    }

    const touched = new Set<Address>(newProjects.map((p) => p.address))
    for (const d of decoded) {
      await applyProjectEvent(tx, d, typeOf.get(d.project)!, { hash, receipt, at, blockTs, schedules })
      events.push({ project: d.project, event: d.event.eventName })
      touched.add(d.project)
    }
    for (const addr of touched) await refreshRecipients(tx, addr)
    return 'processed' as const
  })

  log.info('tx.processed', { txHash: hash, outcome, events: events.length, created: newProjects.length, warnings: warnings.length })
  return {
    status: outcome,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    events: outcome === 'processed' ? events : [],
    projectsCreated: outcome === 'processed' ? newProjects.map((p) => p.address) : [],
    warnings,
  }
}

// ─── On-chain reads ──────────────────────────────────────────────────────────

async function getReceipt(hash: Hex): Promise<TransactionReceipt> {
  try {
    return await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  } catch (e) {
    if (e instanceof TransactionReceiptNotFoundError || e instanceof WaitForTransactionReceiptTimeoutError) {
      throw new ApiError(404, 'TX_NOT_FOUND', 'Transaction not found on-chain (it may not be mined yet, try again shortly)')
    }
    throw e
  }
}

function safeDecode(l: Log): ProjectEvent | null {
  try {
    return decodeEventLog({ abi: PROJECT_EVENTS_ABI, data: l.data, topics: l.topics })
  } catch {
    return null
  }
}

/** Read a new project's parameters (time window, root, signer) and token info */
async function readNewProject(address: Address, type: ProjectType, creator: Address, token: Address, logIndex: number): Promise<NewProjectInfo> {
  const read = <T>(functionName: 'startTime' | 'endTime' | 'merkleRoot' | 'signer') =>
    publicClient.readContract({ address, abi: AIRDROP_READ_ABI, functionName }) as Promise<T>

  const [tokenInfo, startTime, endTime, merkleRoot, signer] = await Promise.all([
    readTokenInfo(token),
    type === 'vesting' ? null : read<bigint>('startTime'),
    type === 'vesting' ? null : read<bigint>('endTime'),
    type === 'merkle' ? read<Hex>('merkleRoot') : null,
    type === 'sign' ? read<Address>('signer') : null,
  ])
  return {
    address, type, creator, token, logIndex, tokenInfo,
    startTime: startTime === null ? null : Number(startTime),
    endTime: endTime === null ? null : Number(endTime),
    merkleRoot: merkleRoot ? (merkleRoot.toLowerCase() as Hex) : null,
    signer: signer ? lower(signer) : null,
  }
}

async function readSchedule(project: Address, id: bigint) {
  return publicClient.readContract({ address: project, abi: VESTING_READ_ABI, functionName: 'getSchedule', args: [id] })
}

/**
 * Validate a signer private key:
 *  - the derived address must equal the on-chain signer
 *  - the account must be brand new: no transactions sent (nonce = 0) and zero native balance
 * Returns null when valid, otherwise a description of the problem.
 */
export async function checkSignerKey(privateKey: Hex, expectedSigner: Address): Promise<string | null> {
  const addr = lower(privateKeyToAccount(privateKey).address)
  if (addr !== expectedSigner) return `Key address ${addr} does not match the on-chain signer ${expectedSigner}`
  const fresh = await checkFreshAccount(addr)
  return fresh.fresh ? null : fresh.reason
}

export async function checkFreshAccount(addr: Address): Promise<{ fresh: true } | { fresh: false; reason: string }> {
  const [nonce, balance] = await Promise.all([
    publicClient.getTransactionCount({ address: addr }),
    publicClient.getBalance({ address: addr }),
  ])
  if (nonce > 0) return { fresh: false, reason: `Signer account ${addr} has already sent ${nonce} transaction(s). Use a brand-new account` }
  if (balance > 0n) return { fresh: false, reason: `Signer account ${addr} holds funds. Use a brand-new empty account` }
  return { fresh: true }
}

// ─── DB writes ───────────────────────────────────────────────────────────────

async function insertProject(tx: Tx, p: NewProjectInfo, hash: Hex, receipt: TransactionReceipt, at: Date, meta?: ProjectMeta) {
  await tx.insert(projects).values({
    address: p.address,
    type: p.type,
    creator: p.creator,
    tokenAddress: p.token,
    tokenSymbol: p.tokenInfo.symbol,
    tokenName: p.tokenInfo.name,
    tokenDecimals: p.tokenInfo.decimals ?? 18,
    totalFunded: '0',            // accumulated by the Funded event that follows
    startTime: p.startTime,
    endTime: p.endTime,
    merkleRoot: p.merkleRoot,
    signerAddress: p.signer,
    name: meta?.name?.trim() || `${p.tokenInfo.symbol ?? 'Token'} ${p.type} ${p.address.slice(0, 8)}`,
    description: meta?.description,
    logoUrl: meta?.logoUrl,
    website: meta?.website,
    twitter: meta?.twitter,
    telegram: meta?.telegram,
    createdTx: hash,
    createdBlock: Number(receipt.blockNumber),
    createdAt: at,
  })
  await tx.insert(projectActivities).values({
    projectAddress: p.address, kind: 'created', actor: p.creator, txHash: hash, logIndex: p.logIndex, at,
    data: { type: p.type, token: p.token },
  })
  await onProjectCreated(tx, p.type, p.address, p.creator, at)
}

interface ApplyCtx {
  hash: Hex
  receipt: TransactionReceipt
  at: Date
  blockTs: number
  schedules: Map<string, ScheduleOnChain>
}

async function applyProjectEvent(tx: Tx, d: DecodedProjectLog, type: ProjectType, ctx: ApplyCtx) {
  const { project, logIndex, event } = d
  const { hash, at, blockTs } = ctx
  const activity = (kind: typeof projectActivities.$inferInsert['kind'], extra: Partial<typeof projectActivities.$inferInsert> = {}) =>
    tx.insert(projectActivities).values({ projectAddress: project, kind, txHash: hash, logIndex, at, ...extra }).onConflictDoNothing()
  const touch = { updatedAt: new Date() }

  switch (event.eventName) {
    case 'Funded': {
      const amt = event.args.amount.toString()
      await tx.update(projects).set({ totalFunded: sql`${projects.totalFunded} + ${amt}::numeric`, ...touch }).where(eq(projects.address, project))
      await activity('funded', { actor: lower(event.args.funder), amount: amt })
      break
    }
    case 'Withdrawn': {
      const amt = event.args.amount.toString()
      // Mirror the contract: withdraw reduces totalFunded
      await tx.update(projects).set({
        totalFunded: sql`${projects.totalFunded} - ${amt}::numeric`,
        totalWithdrawn: sql`${projects.totalWithdrawn} + ${amt}::numeric`,
        ...touch,
      }).where(eq(projects.address, project))
      await activity('withdrawn', { actor: lower(event.args.to), amount: amt })
      break
    }
    case 'Paused': {
      await tx.update(projects).set({ paused: true, pausedSince: blockTs, ...touch }).where(eq(projects.address, project))
      await activity('paused', { actor: lower(event.args.account) })
      break
    }
    case 'Unpaused': {
      // Mirror the contract: totalPausedDuration += now - pausedSince
      await tx.update(projects).set({
        paused: false,
        totalPausedDuration: sql`${projects.totalPausedDuration} + (${blockTs}::bigint - coalesce(${projects.pausedSince}, ${blockTs}::bigint))`,
        pausedSince: null,
        ...touch,
      }).where(eq(projects.address, project))
      await activity('unpaused', { actor: lower(event.args.account) })
      break
    }
    case 'RootUpdated': {
      const root = event.args.newRoot.toLowerCase()
      await tx.update(projects).set({ merkleRoot: root, ...touch }).where(eq(projects.address, project))
      await activity('root_updated', { data: { root } })
      break
    }
    case 'SignerUpdated': {
      const newSigner = lower(event.args.newSigner)
      await tx.update(projects).set({ signerAddress: newSigner, ...touch }).where(eq(projects.address, project))
      await activity('signer_updated', { data: { oldSigner: lower(event.args.oldSigner), newSigner } })
      break
    }
    case 'CreatorTransferInitiated': {
      await tx.update(projects).set({ pendingCreator: lower(event.args.pending), ...touch }).where(eq(projects.address, project))
      await activity('creator_transfer_initiated', { actor: lower(event.args.current), data: { pending: lower(event.args.pending) } })
      break
    }
    case 'CreatorTransferred': {
      const newCreator = lower(event.args.newCreator)
      await tx.update(projects).set({ creator: newCreator, pendingCreator: null, ...touch }).where(eq(projects.address, project))
      await activity('creator_transferred', { actor: newCreator, data: { oldCreator: lower(event.args.oldCreator) } })
      await onCreatorChanged(tx, newCreator, at)
      break
    }
    case 'ScheduleCreated': {
      const s = ctx.schedules.get(`${project}:${event.args.id}`)!
      await tx.insert(vestingSchedules).values({
        projectAddress: project,
        scheduleId: Number(event.args.id),
        beneficiary: lower(s.beneficiary),
        totalAmount: s.totalAmount.toString(),
        claimed: '0',     // accumulated by later Claimed events, so reading "future" state never double-counts
        tgeTime: Number(s.tgeTime),
        tgeBps: s.tgeBps,
        cliffDuration: Number(s.cliffDuration),
        vestingDuration: Number(s.vestingDuration),
        interval: s.interval,
        revocable: s.revocable,
        createdTx: hash,
      }).onConflictDoNothing()
      await activity('schedule_created', {
        actor: lower(event.args.beneficiary), amount: event.args.totalAmount.toString(), data: { scheduleId: Number(event.args.id) },
      })
      break
    }
    case 'ScheduleRevoked': {
      const s = ctx.schedules.get(`${project}:${event.args.id}`)!
      await tx.update(vestingSchedules)
        .set({ revoked: true, revokedClaimableCap: s.revokedClaimableCap.toString() })
        .where(sql`${vestingSchedules.projectAddress} = ${project} and ${vestingSchedules.scheduleId} = ${Number(event.args.id)}`)
      await activity('schedule_revoked', { data: { scheduleId: Number(event.args.id) } })
      break
    }
    case 'Claimed': {
      await applyClaim(tx, project, type, logIndex, event.args, ctx)
      break
    }
  }
}

async function applyClaim(
  tx: Tx, project: Address, type: ProjectType, logIndex: number,
  args: { account: Address; claimKey: bigint; amount: bigint }, ctx: ApplyCtx,
) {
  const account = lower(args.account)
  const amt = args.amount.toString()
  // For sign projects the claimKey is the bytes32 claimId cast to uint256; store it back as 0x + 64 hex chars
  const claimKey = type === 'sign' ? pad(toHex(args.claimKey), { size: 32 }) : args.claimKey.toString()

  await tx.insert(claims).values({
    projectAddress: project, type, account, amount: amt, claimKey,
    txHash: ctx.hash, logIndex, blockNumber: Number(ctx.receipt.blockNumber), claimedAt: ctx.at,
  }).onConflictDoNothing()

  await tx.update(projects)
    .set({ totalClaimed: sql`${projects.totalClaimed} + ${amt}::numeric`, updatedAt: new Date() })
    .where(eq(projects.address, project))

  if (type === 'sign') {
    // Find the matching issued signature to get its nonce; the allocation row may have been deleted by the creator, so upsert as a fallback
    const [iss] = await tx.select({ nonce: signIssuances.nonce }).from(signIssuances)
      .where(sql`${signIssuances.projectAddress} = ${project} and ${signIssuances.claimId} = ${claimKey}`).limit(1)
    const nextNonce = iss ? iss.nonce + 1 : null
    await tx.insert(signAllocations).values({ projectAddress: project, account, amount: amt, claimed: amt, claimNonce: nextNonce ?? 1 })
      .onConflictDoUpdate({
        target: [signAllocations.projectAddress, signAllocations.account],
        set: {
          claimed: sql`${signAllocations.claimed} + ${amt}::numeric`,
          claimNonce: nextNonce === null
            ? sql`${signAllocations.claimNonce} + 1`
            : sql`greatest(${signAllocations.claimNonce}, ${nextNonce})`,
          updatedAt: new Date(),
        },
      })
    await tx.update(signIssuances).set({ usedTx: ctx.hash })
      .where(sql`${signIssuances.projectAddress} = ${project} and ${signIssuances.claimId} = ${claimKey}`)
  } else if (type === 'vesting') {
    await tx.update(vestingSchedules)
      .set({ claimed: sql`${vestingSchedules.claimed} + ${amt}::numeric` })
      .where(sql`${vestingSchedules.projectAddress} = ${project} and ${vestingSchedules.scheduleId} = ${Number(args.claimKey)}`)
  }
  // merkle: claimed status is looked up directly in the claims table (project + index); nothing else to update

  await onClaim(tx, project, account, ctx.at)
}
