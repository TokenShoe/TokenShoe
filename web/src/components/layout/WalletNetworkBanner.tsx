'use client'
/** Shown when the wallet can't reach our chain through its own RPC setting. */
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useWalletNetwork } from '@/hooks/useWalletNetwork'
import { useNetwork } from '@/hooks/useNetwork'

export function WalletNetworkBanner() {
  const { state, fixing, fix } = useWalletNetwork()
  const appChain = useNetwork().network.chain
  if (state !== 'rpc-down') return null
  const rpc = appChain.rpcUrls.default.http[0]
  return (
    <div className="bg-yellow-light text-yellow-text border-b border-border" role="alert">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <AlertTriangle size={16} className="shrink-0" />
        <div className="flex-1 min-w-[240px] leading-relaxed">
          <b>Your wallet can&apos;t reach {appChain.name}.</b> Its saved RPC for this network isn&apos;t responding, so transactions will fail.
          Click <b>Use recommended RPC</b> and approve in your wallet, or set it manually: wallet → Networks → {appChain.name} → RPC URL{' '}
          <code className="font-mono-data text-xs bg-black/5 px-1 py-0.5 rounded">{rpc}</code> (chain ID {appChain.id}).
          Also check your wallet has no pending request waiting.
        </div>
        <Button size="sm" onClick={() => void fix()} loading={fixing}>Use recommended RPC</Button>
      </div>
    </div>
  )
}
