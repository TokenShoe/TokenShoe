/**
 * Stats counters. All of them are called inside the same DB transaction that processes a tx,
 * so events and stats are committed or rolled back together and can never drift apart.
 */
import { sql, eq, and, gt } from 'drizzle-orm'
import type { Tx } from '@/db/client'
import {
  platformStats, projectStats, dailyStats, claimers, projectClaimers, creators,
  merkleTrees, signAllocations, vestingSchedules, projects, type ProjectType,
} from '@/db/schema'

/** Block time -> UTC date string YYYY-MM-DD */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10)

async function ensurePlatformRow(tx: Tx) {
  await tx.insert(platformStats).values({ id: 1 }).onConflictDoNothing()
}

async function bumpDaily(tx: Tx, day: string, col: 'projectsCreated' | 'claims' | 'newClaimers') {
  const column = dailyStats[col]
  await tx
    .insert(dailyStats)
    .values({ day, [col]: 1 })
    .onConflictDoUpdate({ target: dailyStats.day, set: { [col]: sql`${column} + 1` } })
}

/** New project on-chain: total projects +1, per-type +1, first-time creator +1, projects created today +1 */
export async function onProjectCreated(tx: Tx, type: ProjectType, projectAddress: string, creator: string, at: Date) {
  await ensurePlatformRow(tx)
  const typeCol = { merkle: platformStats.totalMerkle, sign: platformStats.totalSign, vesting: platformStats.totalVesting }[type]
  const typeKey = { merkle: 'totalMerkle', sign: 'totalSign', vesting: 'totalVesting' }[type]

  const newCreator = await tx
    .insert(creators).values({ account: creator, firstProjectAt: at }).onConflictDoNothing().returning()

  await tx.update(platformStats).set({
    totalProjects: sql`${platformStats.totalProjects} + 1`,
    [typeKey]: sql`${typeCol} + 1`,
    ...(newCreator.length > 0 ? { totalCreators: sql`${platformStats.totalCreators} + 1` } : {}),
    updatedAt: new Date(),
  }).where(eq(platformStats.id, 1))

  await tx.insert(projectStats).values({ projectAddress }).onConflictDoNothing()
  await bumpDaily(tx, utcDay(at), 'projectsCreated')
}

/** When a project is transferred, the new owner also counts as a creator */
export async function onCreatorChanged(tx: Tx, newCreator: string, at: Date) {
  await ensurePlatformRow(tx)
  const inserted = await tx
    .insert(creators).values({ account: newCreator, firstProjectAt: at }).onConflictDoNothing().returning()
  if (inserted.length > 0) {
    await tx.update(platformStats)
      .set({ totalCreators: sql`${platformStats.totalCreators} + 1`, updatedAt: new Date() })
      .where(eq(platformStats.id, 1))
  }
}

/** One claim: claim count +1; if it is the address's first claim (platform-wide / in this project), the matching unique count +1 */
export async function onClaim(tx: Tx, projectAddress: string, account: string, at: Date) {
  await ensurePlatformRow(tx)
  const day = utcDay(at)

  const firstEver = await tx
    .insert(claimers).values({ account, firstClaimAt: at }).onConflictDoNothing().returning()
  const firstInProject = await tx
    .insert(projectClaimers).values({ projectAddress, account }).onConflictDoNothing().returning()

  await tx.update(platformStats).set({
    totalClaims: sql`${platformStats.totalClaims} + 1`,
    ...(firstEver.length > 0 ? { totalClaimers: sql`${platformStats.totalClaimers} + 1` } : {}),
    updatedAt: new Date(),
  }).where(eq(platformStats.id, 1))

  await tx.update(projectStats).set({
    claimCount: sql`${projectStats.claimCount} + 1`,
    ...(firstInProject.length > 0 ? { claimerCount: sql`${projectStats.claimerCount} + 1` } : {}),
    updatedAt: new Date(),
  }).where(eq(projectStats.projectAddress, projectAddress))

  await bumpDaily(tx, day, 'claims')
  if (firstEver.length > 0) await bumpDaily(tx, day, 'newClaimers')
}

/**
 * Recompute the number of recipients of a project:
 *  merkle  -> number of entries in the tree of the current root
 *  sign    -> number of addresses with an allocation > 0
 *  vesting -> number of distinct beneficiaries
 */
export async function refreshRecipients(tx: Tx, projectAddress: string) {
  const [p] = await tx.select({ type: projects.type, merkleRoot: projects.merkleRoot })
    .from(projects).where(eq(projects.address, projectAddress))
  if (!p) return

  let recipients = 0
  if (p.type === 'merkle') {
    if (p.merkleRoot) {
      const [t] = await tx.select({ n: merkleTrees.totalEntries }).from(merkleTrees).where(eq(merkleTrees.root, p.merkleRoot))
      recipients = t?.n ?? 0
    }
  } else if (p.type === 'sign') {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(signAllocations)
      .where(and(eq(signAllocations.projectAddress, projectAddress), gt(signAllocations.amount, '0')))
    recipients = r?.n ?? 0
  } else {
    const [r] = await tx.select({ n: sql<number>`count(distinct ${vestingSchedules.beneficiary})::int` })
      .from(vestingSchedules).where(eq(vestingSchedules.projectAddress, projectAddress))
    recipients = r?.n ?? 0
  }

  await tx.insert(projectStats).values({ projectAddress, recipients })
    .onConflictDoUpdate({ target: projectStats.projectAddress, set: { recipients, updatedAt: new Date() } })
}
