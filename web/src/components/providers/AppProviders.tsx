'use client'
import { Toaster } from 'sonner'
import { Web3Provider } from './Web3Provider'
import { AuthProvider } from '@/hooks/useAuth'
import { PendingTxSyncer } from './PendingTxSyncer'
import { WalletNetworkProvider } from '@/hooks/useWalletNetwork'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <Web3Provider>
      <WalletNetworkProvider>
        <AuthProvider>
          {children}
          <PendingTxSyncer />
          <Toaster position="bottom-right" richColors closeButton />
        </AuthProvider>
      </WalletNetworkProvider>
    </Web3Provider>
  )
}
