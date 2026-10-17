'use client'
/**
 * Unified transaction flow: switch to the right chain -> wallet signs and sends -> wait for confirmation -> submit to /api/tx to sync the backend
 *
 *   const { send } = useChainTx()
 *   const { hash, sync } = await send({
 *     label: 'Claim tokens',
 *     request: { address, abi, functionName: 'claim', args: [...] },
 *     sync: { meta }   // or false: no sync needed (e.g. approve)
 *   })
 *
 * If syncing fails (network issues etc.) the txHash is saved to localStorage and <PendingTxSyncer/> retries it next time a page opens,
 * so no data is lost even without an indexer.
 */
import { useCallback } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Abi, Hex } from 'viem'
import { api, ApiClientError } from '@/lib/client/api'
import { errorMessage, walletRpcHint } from '@/lib/client/errors'
import { useWalletNetwork } from '@/hooks/useWalletNetwork'
import type { TxSyncResult } from '@/lib/client/types'
import { useNetwork } from '@/hooks/useNetwork'
import type { NetworkKey } from '@/config/networks'
import { getActiveNetwork } from '@/lib/client/activeNetwork'

export interface SyncExtras {
  meta?: Record<string, string | undefined>
  signerPrivateKey?: string
}

export interface SendParams {
  label: string
  request: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[] }
  sync?: SyncExtras | false
}

// ─── Pending-sync queue (localStorage) ───────────────────────────────────────

const PENDING_KEY = 'tokendis.pendingTxs'
/** network: which backend to sync with (entries saved before networks existed have none = testnet) */
interface PendingTx { hash: Hex; meta?: SyncExtras['meta']; at: number; network?: NetworkKey }

function readPending(): PendingTx[] {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '[]') as PendingTx[]
  } catch {
    return []
  }
}
function writePending(list: PendingTx[]) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-50)))
  } catch {
    // If it can't be stored, never mind - it doesn't affect the main flow
  }
}
export function addPending(tx: PendingTx) {
  writePending([...readPending().filter((x) => x.hash !== tx.hash), tx])
}
export function removePending(hash: Hex) {
  writePending(readPending().filter((x) => x.hash !== hash))
}
export function listPending() {
  return readPending()
}

/** Errors not worth retrying (the transaction itself failed) */
const FATAL_SYNC_CODES = new Set(['TX_REVERTED', 'BAD_REQUEST'])

/** Submit to /api/tx of the given network (default: the selected one), retrying network errors up to 3 times */
export async function syncTx(hash: Hex, extras: SyncExtras = {}, network: NetworkKey = getActiveNetwork()): Promise<TxSyncResult> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await api<TxSyncResult>('/api/tx', { json: { txHash: hash, ...extras }, network })
    } catch (e) {
      last = e
      if (e instanceof ApiClientError && (FATAL_SYNC_CODES.has(e.code) || e.code === 'PROJECT_NOT_SYNCED')) throw e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw last
}

export function useChainTx() {
  const { chainId } = useAccount()
  const walletNetwork = useWalletNetwork()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { network } = useNetwork()
  const appChain = network.chain
  const publicClient = usePublicClient({ chainId: appChain.id })
  const queryClient = useQueryClient()

  const send = useCallback(async ({ label, request, sync = {} }: SendParams) => {
    const id = toast.loading(`${label}: confirm in your wallet…`)
    try {
      if (chainId !== appChain.id) await switchChainAsync({ chainId: appChain.id })
      // Make sure the wallet's own RPC works; if not, suggest ours (wallet shows an approval prompt)
      const net = await walletNetwork.fix()
      if (net === 'rpc-down') throw new Error(walletRpcHint())
      if (net === 'wrong-chain') throw new Error(`Switch your wallet to ${appChain.name} (chain ID ${appChain.id}) and try again.`)

      const hash = await writeContractAsync({ ...request, chainId: appChain.id } as Parameters<typeof writeContractAsync>[0])
      toast.loading(`${label}: waiting for confirmation…`, { id })
      const receipt = await publicClient!.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain.')

      let result: TxSyncResult | null = null
      if (sync !== false) {
        toast.loading(`${label}: syncing…`, { id })
        addPending({ hash, meta: sync.meta, at: Date.now(), network: network.key })
        try {
          result = await syncTx(hash, sync, network.key)
          removePending(hash)
        } catch (e) {
          // The tx succeeded on-chain and only the sync failed: keep it queued for retry instead of treating it as a failure
          console.error('[tx] sync failed, will retry later', hash, e)
          toast.warning(`${label} succeeded, but syncing is delayed. It will retry automatically.`, { id })
          await queryClient.invalidateQueries()
          return { hash, sync: null }
        }
        for (const w of result.warnings) toast.warning(w.message, { duration: 10_000 })
      }
      toast.success(`${label}: done`, { id })
      await queryClient.invalidateQueries()
      return { hash, sync: result }
    } catch (e) {
      console.error(`[tx] ${label} failed`, e)
      toast.error(`${label}: ${errorMessage(e)}`, { id })
      throw e
    }
  }, [chainId, switchChainAsync, writeContractAsync, publicClient, queryClient, walletNetwork, network.key, appChain])

  return { send }
}
