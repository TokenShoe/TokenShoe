'use client'
/** Management features shared by all three project types: details, top up, pause/resume, withdraw */
import { useState } from 'react'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { zeroAddress } from 'viem'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Notice } from '@/components/ui/Feedback'
import { Amount } from '../Bits'
import { useChainTx } from '@/hooks/useChainTx'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/errors'
import { formatDateTime, formatToken, parseTokenInput, toInputAmount } from '@/lib/client/format'
import { ERC20_FULL_ABI, PROJECT_BASE_ABI, VESTING_WRITE_ABI } from '@/lib/abis'
import { useNetwork } from '@/hooks/useNetwork'
import type { ProjectDTO } from '@/lib/client/types'

export function Section({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 py-5 border-b border-border last:border-0 first:pt-0">
      <div>
        <h3 className="font-medium text-ink text-sm">{title}</h3>
        {desc && <p className="text-xs text-muted mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export function DetailsForm({ p }: { p: ProjectDTO }) {
  const { ensureSignedIn } = useAuth()
  const qc = useQueryClient()
  const [f, setF] = useState({ name: p.name, description: p.description ?? '', website: p.website ?? '', twitter: p.twitter ?? '', telegram: p.telegram ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      await ensureSignedIn()
      // Don't submit empty optional URL fields (the backend validates URL format)
      const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => k === 'name' || k === 'description' || v.trim()))
      await api(`/api/projects/${p.address}`, { method: 'PATCH', json: body })
      toast.success('Project details saved')
      await qc.invalidateQueries()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Project details" desc="Shown on the public project page.">
      <Input label="Name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Textarea label="Description" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div className="grid sm:grid-cols-3 gap-3">
        <Input label="Website" placeholder="https://…" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
        <Input label="X / Twitter" value={f.twitter} onChange={(e) => setF({ ...f, twitter: e.target.value })} />
        <Input label="Telegram" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={save} loading={busy} disabled={!f.name.trim()} size="sm">Save details</Button>
    </Section>
  )
}

export function FundPanel({ p }: { p: ProjectDTO }) {
  const { address } = useAccount()
  const chainId = useNetwork().network.chain.id
  const { send } = useChainTx()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: p.tokenAddress, abi: ERC20_FULL_ABI, functionName: 'balanceOf', args: [address ?? zeroAddress], chainId },
      { address: p.tokenAddress, abi: ERC20_FULL_ABI, functionName: 'allowance', args: [address ?? zeroAddress, p.address], chainId },
    ],
    query: { enabled: !!address },
  })
  const amount = parseTokenInput(value, p.tokenDecimals)
  const balance = (reads.data?.[0] as bigint | undefined) ?? 0n

  async function fund() {
    if (!amount) return
    setBusy(true)
    try {
      if (((reads.data?.[1] as bigint | undefined) ?? 0n) < amount) {
        await send({ label: `Approve ${p.tokenSymbol}`, request: { address: p.tokenAddress, abi: ERC20_FULL_ABI, functionName: 'approve', args: [p.address, amount] }, sync: false })
      }
      await send({ label: 'Fund project', request: { address: p.address, abi: PROJECT_BASE_ABI, functionName: 'fund', args: [amount] } })
      setValue('')
      await reads.refetch()
    } catch { /* already shown as a toast */ } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Top up" desc={p.type === 'vesting' ? 'Add tokens before adding new schedules.' : 'Add more tokens to the airdrop budget.'}>
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <Input inputMode="decimal" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)}
            hint={`Wallet balance: ${formatToken(balance, p.tokenDecimals)} ${p.tokenSymbol ?? ''}`}
            error={value && amount === null ? 'Not a valid amount' : amount && amount > balance ? 'Exceeds your balance' : undefined} />
        </div>
        <Button onClick={fund} loading={busy} disabled={!amount || amount > balance}>Fund</Button>
      </div>
    </Section>
  )
}

export function PausePanel({ p }: { p: ProjectDTO }) {
  const { send } = useChainTx()
  const [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try {
      await send({ label: p.paused ? 'Resume claims' : 'Pause claims', request: { address: p.address, abi: PROJECT_BASE_ABI, functionName: p.paused ? 'unpause' : 'pause' } })
    } catch { /* already shown as a toast */ } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={p.paused ? 'Claims are paused' : 'Pause claims'}
      desc="Pausing stops all claims. The claim window is extended by however long it stays paused, so recipients don't lose time.">
      <Button variant={p.paused ? 'primary' : 'secondary'} onClick={toggle} loading={busy} size="sm">{p.paused ? 'Resume claims' : 'Pause claims'}</Button>
    </Section>
  )
}

export function WithdrawPanel({ p }: { p: ProjectDTO }) {
  const { address } = useAccount()
  const chainId = useNetwork().network.chain.id
  const { send } = useChainTx()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const bal = useReadContract({ address: p.tokenAddress, abi: ERC20_FULL_ABI, functionName: 'balanceOf', args: [p.address], chainId })
  const vest = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: p.address, abi: VESTING_WRITE_ABI, functionName: 'totalAllocated', chainId },
      { address: p.address, abi: PROJECT_BASE_ABI, functionName: 'totalClaimed', chainId },
    ],
    query: { enabled: p.type === 'vesting' },
  })
  const now = Math.floor(Date.now() / 1000)
  const balance = bal.data ?? 0n
  // Mirror the contract's _recoverableAmount: airdrops are fully withdrawable after the window closes; vesting only the unallocated part
  let withdrawable = 0n
  if (p.type === 'vesting') {
    const reserved = ((vest.data?.[0] as bigint | undefined) ?? 0n) - ((vest.data?.[1] as bigint | undefined) ?? 0n)
    withdrawable = balance > reserved ? balance - reserved : 0n
  } else if (p.effectiveEndTime !== null && now > p.effectiveEndTime) {
    withdrawable = balance
  }
  const amount = parseTokenInput(value, p.tokenDecimals)

  async function withdraw() {
    if (!amount || !address) return
    setBusy(true)
    try {
      await send({ label: 'Withdraw', request: { address: p.address, abi: PROJECT_BASE_ABI, functionName: 'withdraw', args: [address, amount] } })
      setValue('')
      await Promise.all([bal.refetch(), vest.refetch()])
    } catch { /* already shown as a toast */ } finally {
      setBusy(false)
    }
  }

  const locked = p.type !== 'vesting' && withdrawable === 0n
  return (
    <Section title="Withdraw"
      desc={p.type === 'vesting'
        ? 'You can withdraw tokens not reserved for any schedule (including the unvested part of revoked schedules).'
        : 'Unclaimed tokens can be withdrawn after the claim window closes.'}>
      <div className="text-sm">Withdrawable now: <b><Amount wei={withdrawable} decimals={p.tokenDecimals} symbol={p.tokenSymbol} /></b>
        <span className="text-muted"> · contract balance <Amount wei={balance} decimals={p.tokenDecimals} /></span></div>
      {locked && p.effectiveEndTime ? (
        <Notice tone="info">Available after {formatDateTime(p.effectiveEndTime)}.</Notice>
      ) : (
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <Input inputMode="decimal" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)}
              error={value && amount === null ? 'Not a valid amount' : amount && amount > withdrawable ? 'Exceeds withdrawable amount' : undefined} />
          </div>
          <Button variant="secondary" onClick={() => setValue(toInputAmount(withdrawable, p.tokenDecimals))} disabled={withdrawable === 0n}>Max</Button>
          <Button onClick={withdraw} loading={busy} disabled={!amount || amount > withdrawable}>Withdraw</Button>
        </div>
      )}
      {(bal.error || vest.error) && <Notice tone="error">{errorMessage(bal.error ?? vest.error)}</Notice>}
    </Section>
  )
}
