/**
 * API response types used by the frontend (match backend lib/views.ts and lib/eligibility.ts).
 * All amounts are base-unit strings.
 */
import type { ProjectKind } from '@/config/chain'

export type ProjectStatus = 'upcoming' | 'active' | 'paused' | 'ended'

export interface ProjectDTO {
  address: `0x${string}`
  type: ProjectKind
  creator: `0x${string}`
  pendingCreator: `0x${string}` | null
  tokenAddress: `0x${string}`
  tokenSymbol: string | null
  tokenName: string | null
  tokenDecimals: number
  totalFunded: string
  totalClaimed: string
  totalWithdrawn: string
  startTime: number | null
  endTime: number | null
  effectiveEndTime: number | null
  paused: boolean
  merkleRoot: `0x${string}` | null
  signerAddress: `0x${string}` | null
  name: string
  description: string | null
  logoUrl: string | null
  website: string | null
  twitter: string | null
  telegram: string | null
  createdTx: `0x${string}`
  createdAt: string
  status: ProjectStatus
  stats: { recipients: number; claimCount: number; claimerCount: number }
  signerReady?: boolean
}

export interface ScheduleDTO {
  scheduleId: number
  beneficiary?: string
  totalAmount: string
  claimed: string
  claimable: string
  unlocked?: string
  tgeTime: number
  tgeBps: number
  cliffDuration: number
  vestingDuration: number
  interval: number
  revocable: boolean
  revoked: boolean
}

export interface EligibilityDTO {
  project: ProjectDTO
  allocated: string
  claimed: string
  claimable: string
  merkle?: { index: number; amount: string }
  schedules?: ScheduleDTO[]
}

export interface ClaimDTO {
  id: number
  projectAddress: string
  type: ProjectKind
  account: string
  amount: string
  claimKey: string
  txHash: `0x${string}`
  claimedAt: string
  project?: { projectName: string; tokenSymbol: string | null; tokenDecimals: number; tokenAddress: string }
}

export interface ActivityDTO {
  id: number
  kind: string
  actor: string | null
  amount: string | null
  data: Record<string, unknown> | null
  txHash: `0x${string}`
  at: string
}

export interface PlatformStatsDTO {
  totalProjects: number
  totalMerkle: number
  totalSign: number
  totalVesting: number
  totalCreators: number
  totalClaims: number
  totalClaimers: number
  totalRecipients: number
}

export interface DailyStatDTO {
  day: string
  projectsCreated: number
  claims: number
  newClaimers: number
}

export interface TxSyncResult {
  status: 'processed' | 'already_processed' | 'no_relevant_events'
  txHash: `0x${string}`
  events: { project: string; event: string }[]
  projectsCreated: `0x${string}`[]
  warnings: { code: string; message: string; project?: string }[]
}
