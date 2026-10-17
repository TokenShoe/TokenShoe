'use client'
/**
 * Wallet network health, shared by the banner and the transaction flow.
 *
 * - When a wallet connects (and is on the selected network's chain), silently probe its RPC.
 * - If the probe fails, suggest our RPC once per address per session (the wallet shows an approval prompt).
 * - If it still fails, <WalletNetworkBanner/> explains how to fix it and offers a retry button.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useNetwork } from '@/hooks/useNetwork'
import { ensureWalletNetwork, probeWallet, type Eip1193, type WalletNetworkState } from '@/lib/client/walletNetwork'

interface Ctx {
  /** null = not checked yet / not applicable (disconnected or on another chain) */
  state: WalletNetworkState | null
  fixing: boolean
  /** Probe and, if needed, suggest our RPC. Returns the final state. */
  fix: () => Promise<WalletNetworkState | null>
}

const WalletNetworkContext = createContext<Ctx | null>(null)

export function WalletNetworkProvider({ children }: { children: React.ReactNode }) {
  const { status, connector, chainId, address } = useAccount()
  const appChain = useNetwork().network.chain
  const [state, setState] = useState<WalletNetworkState | null>(null)
  const [fixing, setFixing] = useState(false)
  const autoTried = useRef(new Set<string>())

  const getProvider = useCallback(async () => (connector ? ((await connector.getProvider()) as Eip1193) : null), [connector])

  const fix = useCallback(async () => {
    const provider = await getProvider()
    if (!provider) return null
    setFixing(true)
    try {
      const result = await ensureWalletNetwork(provider, appChain)
      setState(result === 'wrong-chain' ? null : result)
      return result
    } finally {
      setFixing(false)
    }
  }, [getProvider, appChain])

  // Check on connect / account change / chain change
  useEffect(() => {
    if (status !== 'connected' || chainId !== appChain.id || !address) {
      setState(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const provider = await getProvider()
      if (!provider || cancelled) return
      const result = await probeWallet(provider, appChain)
      if (cancelled) return
      setState(result === 'wrong-chain' ? null : result)
      // Broken RPC: suggest ours automatically, but only once per address per session
      const key = address.toLowerCase()
      if (result === 'rpc-down' && !autoTried.current.has(key)) {
        autoTried.current.add(key)
        await fix()
      }
    })()
    return () => { cancelled = true }
  }, [status, chainId, address, getProvider, fix, appChain])

  return <WalletNetworkContext.Provider value={{ state, fixing, fix }}>{children}</WalletNetworkContext.Provider>
}

export function useWalletNetwork() {
  const ctx = useContext(WalletNetworkContext)
  if (!ctx) throw new Error('useWalletNetwork must be used inside <WalletNetworkProvider>')
  return ctx
}
