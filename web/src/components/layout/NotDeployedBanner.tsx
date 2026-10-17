'use client'
/**
 * Shown under the nav when the selected network has no TokenShoe contracts yet (e.g. Arc Mainnet before launch),
 * plus a gate for pages that need the contracts (Create).
 */
import { Info } from 'lucide-react'
import { DEFAULT_NETWORK, isDeployed, NETWORKS } from '@/config/networks'
import { useNetwork } from '@/hooks/useNetwork'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Feedback'

export function NotDeployedBanner() {
  const { network, setNetwork } = useNetwork()
  if (isDeployed(network)) return null
  const fallback = NETWORKS[DEFAULT_NETWORK]
  return (
    <div className="bg-blue-light text-blue-text border-b border-border" role="status">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Info size={16} className="shrink-0" />
        <div className="flex-1 min-w-[240px] leading-relaxed">
          <b>TokenShoe is coming soon to {network.label}.</b> Creating projects isn&apos;t available here yet.
        </div>
        <Button size="sm" variant="secondary" onClick={() => setNetwork(fallback.key)}>Switch to {fallback.label}</Button>
      </div>
    </div>
  )
}

/** Renders children only when TokenShoe is deployed on the selected network */
export function RequireDeployed({ children }: { children: React.ReactNode }) {
  const { network, setNetwork } = useNetwork()
  if (isDeployed(network)) return <>{children}</>
  const fallback = NETWORKS[DEFAULT_NETWORK]
  return (
    <Card className="max-w-xl mx-auto">
      <EmptyState
        title={`Not available on ${network.label} yet`}
        action={<Button onClick={() => setNetwork(fallback.key)}>Switch to {fallback.label}</Button>}
      >
        TokenShoe contracts haven&apos;t been deployed on {network.label}. You can try everything on {fallback.label} today.
      </EmptyState>
    </Card>
  )
}
