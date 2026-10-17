'use client'
/**
 * On page load and every minute, resubmit transactions that previously failed to sync (each to the network it was sent on).
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/client/api'
import { listPending, removePending, syncTx } from '@/hooks/useChainTx'

export function PendingTxSyncer() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let running = false
    const run = async () => {
      if (running) return
      running = true
      try {
        for (const tx of listPending()) {
          try {
            await syncTx(tx.hash, { meta: tx.meta }, tx.network ?? 'testnet')
            removePending(tx.hash)
            await queryClient.invalidateQueries()
          } catch (e) {
            // Transaction reverted, or still unsynced after 7 days -> give up
            const fatal = e instanceof ApiClientError && e.code === 'TX_REVERTED'
            if (fatal || Date.now() - tx.at > 7 * 86400_000) removePending(tx.hash)
          }
        }
      } finally {
        running = false
      }
    }
    void run()
    const t = setInterval(run, 60_000)
    return () => clearInterval(t)
  }, [queryClient])
  return null
}
