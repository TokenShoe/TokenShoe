'use client'
/**
 * Form that deploys a test ERC-20 via TestTokenFactory: 18 decimals, 100,000,000 tokens minted to the connected wallet.
 * Used inline in the create wizard (compact) and on the /test-token page.
 */
import { useState } from 'react'
import { usePublicClient } from 'wagmi'
import { decodeEventLog, type Address } from 'viem'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useChainTx } from '@/hooks/useChainTx'
import { TEST_TOKEN_FACTORY_ABI } from '@/lib/abis'
import { useNetwork } from '@/hooks/useNetwork'

export const TEST_TOKEN_SUPPLY_LABEL = '100,000,000'

export interface CreatedToken { address: Address; name: string; symbol: string }

export function CreateTestToken({ onCreated, compact }: { onCreated?: (t: CreatedToken) => void; compact?: boolean }) {
  const { send } = useChainTx()
  const { network } = useNetwork()
  const factory = network.testTokenFactory
  const publicClient = usePublicClient({ chainId: network.chain.id })
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [busy, setBusy] = useState(false)

  const nameErr = name.length > 50 ? 'At most 50 characters' : undefined
  const symbolErr = symbol && !/^[A-Z0-9]{1,11}$/.test(symbol) ? '1-11 letters or digits' : undefined
  const valid = name.trim().length > 0 && symbol.length > 0 && !nameErr && !symbolErr

  async function create() {
    if (!factory || !valid) return
    setBusy(true)
    try {
      const { hash } = await send({
        label: `Create ${symbol}`,
        request: { address: factory, abi: TEST_TOKEN_FACTORY_ABI, functionName: 'createToken', args: [name.trim(), symbol] },
        sync: false, // not a distribution event, nothing for the backend to record
      })
      // Read the new token address from the TokenCreated event
      const receipt = await publicClient!.getTransactionReceipt({ hash })
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== factory.toLowerCase()) continue
        try {
          const ev = decodeEventLog({ abi: TEST_TOKEN_FACTORY_ABI, data: log.data, topics: log.topics })
          if (ev.eventName === 'TokenCreated') {
            onCreated?.({ address: ev.args.token, name: ev.args.name, symbol: ev.args.symbol })
            setName('')
            setSymbol('')
            break
          }
        } catch { /* not our event */ }
      }
    } catch { /* already shown as a toast */ } finally {
      setBusy(false)
    }
  }

  if (!factory) return null

  return (
    <div className="space-y-3">
      <div className={compact ? 'grid grid-cols-[2fr_1fr] gap-3' : 'grid sm:grid-cols-[2fr_1fr] gap-3'}>
        <Input label="Token name" placeholder="e.g. Demo Token" maxLength={50} value={name}
          onChange={(e) => setName(e.target.value)} error={nameErr} />
        <Input label="Symbol" placeholder="DEMO" maxLength={11} value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} error={symbolErr} />
      </div>
      <Button onClick={create} loading={busy} disabled={!valid} className={compact ? 'w-full' : undefined}>
        <Sparkles size={14} /> Create & mint {TEST_TOKEN_SUPPLY_LABEL} {symbol || 'tokens'}
      </Button>
      <p className="text-xs text-muted">
        A standard ERC-20 with 18 decimals. The full supply goes to your wallet. Testnet only — it has no value.
      </p>
    </div>
  )
}
