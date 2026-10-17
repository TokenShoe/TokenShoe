/**
 * Turn DB rows into the shape returned to the frontend (adding computed fields such as the current project status)
 */
import type { Project } from '@/db/schema'
import { projectStats } from '@/db/schema'

export type ProjectStatus = 'upcoming' | 'active' | 'paused' | 'ended'

/** Mirror the contract's effectiveEndTime: the end is pushed back by however long the project was paused */
export function effectiveEndTime(p: Project, now = Math.floor(Date.now() / 1000)): number | null {
  if (p.endTime === null) return null
  const activePause = p.paused && p.pausedSince ? now - p.pausedSince : 0
  return p.endTime + p.totalPausedDuration + activePause
}

export function projectStatus(p: Project, now = Math.floor(Date.now() / 1000)): ProjectStatus {
  if (p.type === 'vesting') return p.paused ? 'paused' : 'active'   // vesting has no single time window
  if (p.paused) return 'paused'
  if (p.startTime !== null && now < p.startTime) return 'upcoming'
  const end = effectiveEndTime(p, now)
  if (end !== null && now > end) return 'ended'
  return 'active'
}

export function projectView(p: Project, stats?: typeof projectStats.$inferSelect | null) {
  return {
    ...p,
    effectiveEndTime: effectiveEndTime(p),
    status: projectStatus(p),
    stats: stats
      ? { recipients: stats.recipients, claimCount: stats.claimCount, claimerCount: stats.claimerCount }
      : { recipients: 0, claimCount: 0, claimerCount: 0 },
  }
}
