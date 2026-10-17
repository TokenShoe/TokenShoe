/**
 * What can an address claim? (one unified shape for all three types), used by the Claim page.
 *
 * Each item:
 *   project      project info (including status)
 *   allocated    total allocation (wei)
 *   claimed      already claimed (wei)
 *   claimable    claimable right now (wei); 0 for merkle/sign outside the claim window
 *   merkle?      { index, amount }        - the proof still has to be fetched from merkle-proof before claiming
 *   schedules?   vesting schedules with their claimable amounts (pass the scheduleIds to claim)
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects, merkleEntries, signAllocations, vestingSchedules, claims, type Project } from '@/db/schema'
import { projectView } from './views'
import { claimableAmount } from './vesting'

export interface EligibilityItem {
  project: ReturnType<typeof projectView>
  allocated: string
  claimed: string
  claimable: string
  merkle?: { index: number; amount: string }
  schedules?: {
    scheduleId: number; totalAmount: string; claimed: string; claimable: string
    tgeTime: number; tgeBps: number; cliffDuration: number; vestingDuration: number; interval: number
    revocable: boolean; revoked: boolean
  }[]
}

export async function eligibilityFor(account: string, onlyProject?: string): Promise<EligibilityItem[]> {
  const now = Math.floor(Date.now() / 1000)
  const projectFilter = onlyProject ? eq(projects.address, onlyProject) : undefined
  const items: EligibilityItem[] = []

  // ── Merkle: list entries -> projects pointing at that root; claimed = this index exists in the claims table
  const merkleRows = await db()
    .select({ project: projects, index: merkleEntries.index, amount: merkleEntries.amount, claimTx: claims.txHash })
    .from(merkleEntries)
    .innerJoin(projects, and(eq(projects.merkleRoot, merkleEntries.root), eq(projects.type, 'merkle'), projectFilter))
    .leftJoin(claims, and(eq(claims.projectAddress, projects.address), eq(claims.claimKey, sql`${merkleEntries.index}::text`)))
    .where(eq(merkleEntries.account, account))
  for (const r of merkleRows) {
    const view = projectView(r.project)
    const claimed = r.claimTx ? r.amount : '0'
    items.push({
      project: view,
      allocated: r.amount,
      claimed,
      claimable: !r.claimTx && view.status === 'active' ? r.amount : '0',
      merkle: { index: r.index, amount: r.amount },
    })
  }

  // ── Sign: allocation - claimed
  const signRows = await db()
    .select({ project: projects, alloc: signAllocations })
    .from(signAllocations)
    .innerJoin(projects, and(eq(projects.address, signAllocations.projectAddress), projectFilter))
    .where(and(eq(signAllocations.account, account), sql`${signAllocations.amount} > 0`))
  for (const r of signRows) {
    const view = projectView(r.project)
    const left = BigInt(r.alloc.amount) - BigInt(r.alloc.claimed)
    items.push({
      project: view,
      allocated: r.alloc.amount,
      claimed: r.alloc.claimed,
      claimable: view.status === 'active' && left > 0n ? left.toString() : '0',
    })
  }

  // ── Vesting: group by project and compute what is claimable now for each schedule
  const vestRows = await db().select().from(vestingSchedules)
    .where(and(eq(vestingSchedules.beneficiary, account), onlyProject ? eq(vestingSchedules.projectAddress, onlyProject) : undefined))
  if (vestRows.length > 0) {
    const addrs = [...new Set(vestRows.map((s) => s.projectAddress))]
    const projRows = await db().select().from(projects).where(inArray(projects.address, addrs))
    const byAddr = new Map<string, Project>(projRows.map((p) => [p.address, p]))
    for (const addr of addrs) {
      const p = byAddr.get(addr)
      if (!p) continue
      const schedules = vestRows.filter((s) => s.projectAddress === addr).map((s) => {
        const c = claimableAmount({
          totalAmount: BigInt(s.totalAmount), claimed: BigInt(s.claimed), tgeTime: s.tgeTime, tgeBps: s.tgeBps,
          cliffDuration: s.cliffDuration, vestingDuration: s.vestingDuration, interval: s.interval,
          revoked: s.revoked, revokedClaimableCap: BigInt(s.revokedClaimableCap),
        }, now)
        return {
          scheduleId: s.scheduleId, totalAmount: s.totalAmount, claimed: s.claimed, claimable: c.toString(),
          tgeTime: s.tgeTime, tgeBps: s.tgeBps, cliffDuration: s.cliffDuration, vestingDuration: s.vestingDuration,
          interval: s.interval, revocable: s.revocable, revoked: s.revoked,
        }
      })
      const sum = (k: 'totalAmount' | 'claimed' | 'claimable') => schedules.reduce((a, s) => a + BigInt(s[k]), 0n).toString()
      items.push({
        project: projectView(p),
        // For revoked schedules the total allocation is what had unlocked at revocation
        allocated: vestRows.filter((s) => s.projectAddress === addr)
          .reduce((a, s) => a + BigInt(s.revoked ? s.revokedClaimableCap : s.totalAmount), 0n).toString(),
        claimed: sum('claimed'),
        claimable: sum('claimable'),
        schedules,
      })
    }
  }

  // Claimable items first, then newest projects first
  return items.sort((a, b) =>
    Number(BigInt(b.claimable) > 0n) - Number(BigInt(a.claimable) > 0n) ||
    +new Date(b.project.createdAt) - +new Date(a.project.createdAt))
}
