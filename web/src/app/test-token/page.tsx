'use client'
/**
 * Test tokens: mint a 100M test ERC-20, list the ones you created, and jump into the create wizard with one.
 */
import { useState } from 'react'
import { useAccount, useReadContract, useReadContracts, useWatchAsset } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { ArrowRight, Copy, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/Button'
import { Loading, EmptyState, Notice } from '@/components/ui/Feedback'
import { AddressLink } from '@/components/project/Bits'
import { CreateTestToken, TEST_TOKEN_SUPPLY_LABEL } from '@/components/test-token/CreateTestToken'
import { ERC20_FULL_ABI, TEST_TOKEN_FACTORY_ABI } from '@/lib/abis'
import { formatToken } from '@/lib/client/format'
import { useNetwork } from '@/hooks/useNetwork'

const STEPS = [
  { title: 'Create a test token', desc: `Pick a name and symbol. ${TEST_TOKEN_SUPPLY_LABEL} tokens land in your wallet.` },
  { title: 'Launch a distribution', desc: 'Use it in a Merkle airdrop, signature airdrop or vesting schedule.' },
  { title: 'Claim from another wallet', desc: 'Add a second address to your list and claim from the Claim page.' },
]

export default function TestTokenPage() {
  const { address, isConnected } = useAccount()
  const { network } = useNetwork()
  const [highlight, setHighlight] = useState<string | null>(null)

  if (!network.testTokenFactory) {
    return (
      <Card className="max-w-xl mx-auto">
        <EmptyState title="Test tokens are not available on this network" />
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Test tokens</h1>
        <p className="text-muted text-sm mt-1">
          Mint an ERC-20 on {network.label} to try every distribution type end to end ({network.chain.testnet ? 'free' : 'you only pay gas'}). Test tokens have no value.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Card>
          <CardHeader><h2 className="font-display font-semibold text-ink">Create a test token</h2></CardHeader>
          <CardBody>
            {isConnected ? (
              <CreateTestToken onCreated={(t) => setHighlight(t.address.toLowerCase())} />
            ) : (
              <div className="py-6 text-center space-y-3">
                <p className="text-sm text-muted">Connect a wallet to receive the tokens.</p>
                <div className="flex justify-center"><ConnectKitButton /></div>
              </div>
            )}
          </CardBody>
        </Card>

        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-ink text-white text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
              <div>
                <div className="text-sm font-medium text-ink">{s.title}</div>
                <div className="text-xs text-muted leading-relaxed mt-0.5">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {address && <MyTokens owner={address} highlight={highlight} />}
    </div>
  )
}

function MyTokens({ owner, highlight }: { owner: `0x${string}`; highlight: string | null }) {
  const { network } = useNetwork()
  const chainId = network.chain.id
  const list = useReadContract({
    address: network.testTokenFactory!, abi: TEST_TOKEN_FACTORY_ABI, functionName: 'tokensOf', args: [owner], chainId,
  })
  // Newest first
  const tokens = [...(list.data ?? [])].reverse()
  const details = useReadContracts({
    allowFailure: true,
    contracts: tokens.flatMap((t) => [
      { address: t, abi: ERC20_FULL_ABI, functionName: 'name', chainId },
      { address: t, abi: ERC20_FULL_ABI, functionName: 'symbol', chainId },
      { address: t, abi: ERC20_FULL_ABI, functionName: 'balanceOf', args: [owner], chainId },
    ] as const),
    query: { enabled: tokens.length > 0 },
  })

  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-ink">Your test tokens</h2>
      {list.isLoading ? <Loading /> : tokens.length === 0 ? (
        <Card><EmptyState title="No test tokens yet">Create one above to get started.</EmptyState></Card>
      ) : (
        <div className="space-y-2">
          {tokens.map((t, i) => {
            const name = details.data?.[i * 3]?.result as string | undefined
            const symbol = details.data?.[i * 3 + 1]?.result as string | undefined
            const balance = details.data?.[i * 3 + 2]?.result as bigint | undefined
            return (
              <TokenRow key={t} address={t} name={name} symbol={symbol} balance={balance} isNew={highlight === t.toLowerCase()} />
            )
          })}
        </div>
      )}
      {list.error && <Notice tone="error">Could not load your test tokens.</Notice>}
    </section>
  )
}

function TokenRow({ address, name, symbol, balance, isNew }: {
  address: `0x${string}`; name?: string; symbol?: string; balance?: bigint; isNew: boolean
}) {
  const { watchAssetAsync } = useWatchAsset()

  async function addToWallet() {
    if (!symbol) return
    try {
      await watchAssetAsync({ type: 'ERC20', options: { address, symbol, decimals: 18 } })
      toast.success(`${symbol} added to your wallet`)
    } catch {
      toast.error('Your wallet did not add the token')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Address copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className={clsx(
      'bg-surface border rounded-card px-5 py-4 shadow-card flex flex-wrap items-center justify-between gap-3 transition-colors',
      isNew ? 'border-ink' : 'border-border',
    )}>
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink truncate">{name ?? '…'}</span>
          <span className="text-xs text-muted">{symbol}</span>
          {isNew && <span className="text-xs text-green-text">● New</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <AddressLink address={address} />
          <span>Balance <span className="text-ink">{balance !== undefined ? formatToken(balance, 18, 2) : '—'}</span></span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={copy} className="p-2 rounded-btn text-muted hover:text-ink hover:bg-black/5" aria-label="Copy address" title="Copy address"><Copy size={14} /></button>
        <button onClick={addToWallet} className="p-2 rounded-btn text-muted hover:text-ink hover:bg-black/5" aria-label="Add to wallet" title="Add to wallet"><Wallet size={14} /></button>
        <LinkButton href={`/create?token=${address}`} size="sm" variant="secondary" className="ml-1">Distribute <ArrowRight size={12} /></LinkButton>
      </div>
    </div>
  )
}
