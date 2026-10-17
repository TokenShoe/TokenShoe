'use client'
/**
 * Wallet connection (wagmi + ConnectKit)
 *
 * "Mock wallet" for development/testing: when NEXT_PUBLIC_MOCK_WALLET=1 and the chain is local anvil,
 * wagmi's mock connector auto-connects an anvil test account (anvil signs and sends on its behalf),
 * so the full flow can run in a browser without MetaMask.
 * Choose the account with localStorage.setItem('mockAccount', '0x...'); defaults to anvil account 0.
 * Never enable this in production.
 */
import { useEffect, useState } from 'react'
import { WagmiProvider, createConfig, http, useConnect, useAccount } from 'wagmi'
import { mock } from '@wagmi/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider, getDefaultConfig } from 'connectkit'
import { appChain } from '@/config/chain'

const MOCK = process.env.NEXT_PUBLIC_MOCK_WALLET === '1' && appChain.id === 31337
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function mockAccount(): `0x${string}` {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem('mockAccount') : null
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`
  } catch {
    // localStorage may be unavailable (e.g. private browsing); ignore
  }
  return ANVIL_ACCOUNT_0
}

function buildConfig() {
  return createConfig(
    getDefaultConfig({
      chains: [appChain],
      transports: { [appChain.id]: http(appChain.rpcUrls.default.http[0]) },
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
      appName: 'TokenDis',
      appDescription: 'Token distribution on Arc — Merkle airdrops, signature airdrops and vesting',
      ssr: true,
      ...(MOCK ? { connectors: [mock({ accounts: [mockAccount()], features: { reconnect: true } })] } : {}),
    }),
  )
}

/** Auto-connect in mock wallet mode */
function MockAutoConnect() {
  const { connect, connectors } = useConnect()
  const { isConnected } = useAccount()
  useEffect(() => {
    if (MOCK && !isConnected && connectors[0]) connect({ connector: connectors[0] })
  }, [isConnected, connectors, connect])
  return null
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  // Kept in state so it's created once per browser session, not again on hot reload
  const [config] = useState(buildConfig)
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } } }),
  )
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          customTheme={{
            '--ck-font-family': "'DM Sans', sans-serif",
            '--ck-primary-button-background': '#111111',
            '--ck-primary-button-hover-background': '#333333',
            '--ck-body-background': '#FFFFFF',
            '--ck-body-color': '#111111',
            '--ck-border-radius': '8px',
          }}
        >
          {MOCK && <MockAutoConnect />}
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
