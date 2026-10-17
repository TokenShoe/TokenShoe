/** Form state of the create wizard */
import type { ProjectKind } from '@/config/networks'

export interface MerkleBuild { root: `0x${string}`; totalEntries: number; totalAmount: string; decimals: number; preview: { index: number; account: string; amount: string }[] }
export interface VestingBuild { totalAmount: string; initData: `0x${string}`; count: number }
export interface RowError { line: number; message: string }

export interface VestingRow {
  beneficiary: string
  amount: string
  tgeTime: string        // datetime-local
  tgePercent: string
  cliffDays: string
  vestingDays: string
  intervalDays: string
  revocable: boolean
}

export interface WizardState {
  type: ProjectKind
  token: string
  // Airdrop claim window (merkle / sign)
  start: string
  end: string
  // merkle
  merkleFile: File | null
  merkle: MerkleBuild | null
  // sign
  signerKey: string
  signerAddress: string
  signerFresh: boolean | null
  signerBackedUp: boolean
  signFile: File | null
  // vesting
  vestingMode: 'csv' | 'manual'
  vestingFile: File | null
  vestingRows: VestingRow[]
  vesting: VestingBuild | null
  // Deposit amount (token units)
  fundAmount: string
  // Display info
  name: string
  description: string
  website: string
  twitter: string
  telegram: string
}

export type Patch = (p: Partial<WizardState>) => void

export interface TokenInfo { symbol: string; decimals: number; balance: bigint; name: string }
