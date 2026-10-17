'use client'
import { Toaster } from 'sonner'
import { Web3Provider } from './Web3Provider'
import { AuthProvider } from '@/hooks/useAuth'
import { PendingTxSyncer } from './PendingTxSyncer'
import { WalletNetworkProvider } from '@/hooks/useWalletNetwork'
import { NetworkProvider } from '@/hooks/useNetwork'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <Web3Provider>
      {/* Everything inside NetworkProvider remounts when the user switches network */}
      <NetworkProvider>
        <WalletNetworkProvider>
          <AuthProvider>{children}</AuthProvider>
        </WalletNetworkProvider>
      </NetworkProvider>
      {/* Outside the remount: pending syncs and toasts survive a network switch */}
      <PendingTxSyncer />
      <Toaster position="bottom-right" richColors closeButton />
    </Web3Provider>
  )
}
