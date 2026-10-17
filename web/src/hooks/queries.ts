'use client'
/**
 * Data-fetching hooks (react-query). After a successful sync, useChainTx invalidates every query so they refetch.
 */
import { useQuery } from '@tanstack/react-query'
import { api, type Page } from '@/lib/client/api'
import type {
  ProjectDTO, PlatformStatsDTO, DailyStatDTO, EligibilityDTO, ClaimDTO, ActivityDTO, ScheduleDTO,
} from '@/lib/client/types'

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => api<PlatformStatsDTO>('/api/stats') })

export const useDailyStats = (days = 30) =>
  useQuery({ queryKey: ['stats', 'daily', days], queryFn: () => api<{ items: DailyStatDTO[] }>(`/api/stats/daily?days=${days}`) })

export const useProjects = (params: { creator?: string; type?: string; page?: number; pageSize?: number }, enabled = true) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return useQuery({ queryKey: ['projects', params], queryFn: () => api<Page<ProjectDTO>>(`/api/projects?${q}`), enabled })
}

export const useProject = (address: string) =>
  useQuery({ queryKey: ['project', address], queryFn: () => api<ProjectDTO>(`/api/projects/${address}`), retry: false })

export const useClaimable = (account?: string) =>
  useQuery({
    queryKey: ['claimable', account],
    queryFn: () => api<{ items: EligibilityDTO[] }>(`/api/accounts/${account}/claimable`),
    enabled: !!account,
  })

export const useEligibility = (project: string, account?: string) =>
  useQuery({
    queryKey: ['eligibility', project, account],
    queryFn: () => api<({ eligible: true } & EligibilityDTO) | { eligible: false }>(`/api/projects/${project}/eligibility?account=${account}`),
    enabled: !!account,
  })

export const useAccountClaims = (account?: string, page = 1) =>
  useQuery({
    queryKey: ['account-claims', account, page],
    queryFn: () => api<Page<ClaimDTO>>(`/api/accounts/${account}/claims?page=${page}&pageSize=20`),
    enabled: !!account,
  })

export const useProjectClaims = (project: string, page = 1) =>
  useQuery({ queryKey: ['project-claims', project, page], queryFn: () => api<Page<ClaimDTO>>(`/api/projects/${project}/claims?page=${page}&pageSize=20`) })

export const useProjectActivities = (project: string, page = 1) =>
  useQuery({ queryKey: ['project-activities', project, page], queryFn: () => api<Page<ActivityDTO>>(`/api/projects/${project}/activities?page=${page}&pageSize=20`) })

export const useVestingSchedules = (project: string, page = 1, enabled = true) =>
  useQuery({
    queryKey: ['vesting-schedules', project, page],
    queryFn: () => api<Page<ScheduleDTO & { beneficiary: string }>>(`/api/projects/${project}/vesting/schedules?page=${page}&pageSize=20`),
    enabled,
  })

export interface SignAllocationRow { account: string; amount: string; claimed: string; claimNonce: number; updatedAt: string }
export const useSignAllocations = (project: string, page: number, account: string, enabled: boolean) =>
  useQuery({
    queryKey: ['sign-allocations', project, page, account],
    queryFn: () => api<Page<SignAllocationRow> & { summary: { count: number; totalAllocated: string; totalClaimed: string } }>(
      `/api/projects/${project}/sign/allocations?page=${page}&pageSize=20${account ? `&account=${account}` : ''}`),
    enabled,
  })

export const useMerkleTree = (root: string | null, page: number, account: string) =>
  useQuery({
    queryKey: ['merkle-tree', root, page, account],
    queryFn: () => api<Page<{ index: number; account: string; amount: string }> & { tree: { totalEntries: number; totalAmount: string; fileName: string | null } }>(
      `/api/merkle/trees/${root}?page=${page}&pageSize=20${account ? `&account=${account}` : ''}`),
    enabled: !!root,
  })
