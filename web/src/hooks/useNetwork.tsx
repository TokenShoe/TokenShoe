'use client'
/**
 * Selected network (Arc Testnet / Arc Mainnet) for the whole app.
 *
 *   const { network, setNetwork } = useNetwork()
 *   network.chain / network.factory / network.testTokenFactory / network.label ...
 *
 * Switching clears cached API data and remounts everything below the provider, so every page reloads its data
 * from the new network's backend. If a wallet is connected, it is asked to switch chains too.
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_NETWORK, explorerAddress, explorerTx, NETWORKS, type NetworkConfig, type NetworkKey } from '@/config/networks'
import { initialNetwork, saveNetworkChoice, syncActiveNetwork } from '@/lib/client/activeNetwork'

interface Ctx {
  network: NetworkConfig
  setNetwork: (key: NetworkKey) => void
  explorerAddress: (a: string) => string
  explorerTx: (h: string) => string
}

const NetworkContext = createContext<Ctx | null>(null)

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  // Server render and first client render use the default so hydration matches; the saved choice is applied right after
  const [key, setKey] = useState<NetworkKey>(DEFAULT_NETWORK)
  // Keep the module-level value (used by api()) in step with what is being rendered
  syncActiveNetwork(key)

  const queryClient = useQueryClient()
  const { isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  useEffect(() => {
    const initial = initialNetwork()
    // Persist it too, so a shared ?network= link keeps that network on later visits
    saveNetworkChoice(initial)
    if (initial === DEFAULT_NETWORK) return
    syncActiveNetwork(initial)
    queryClient.clear()
    setKey(initial)
  }, [queryClient])

  const setNetwork = useCallback((next: NetworkKey) => {
    if (next === key) return
    syncActiveNetwork(next)
    saveNetworkChoice(next)
    // Cached API responses belong to the old network's backend
    queryClient.clear()
    setKey(next)
    const target = NETWORKS[next].chain.id
    // Ask the wallet to follow; transactions also switch on demand, so a rejection here is fine
    if (isConnected && chainId !== target) switchChain({ chainId: target }, { onError: () => {} })
  }, [key, queryClient, isConnected, chainId, switchChain])

  const network = NETWORKS[key]
  const value: Ctx = {
    network,
    setNetwork,
    explorerAddress: (a) => explorerAddress(network, a),
    explorerTx: (h) => explorerTx(network, h),
  }

  return (
    <NetworkContext.Provider value={value}>
      {/* key: remount the app on switch so no state from the other network survives */}
      <Fragment key={key}>{children}</Fragment>
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>')
  return ctx
}
