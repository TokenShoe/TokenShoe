'use client'
/**
 * Create-project wizard: type -> token -> list/parameters -> project details -> review & deploy
 *
 * Deploy flow (Review step):
 *   0. Read the factory's implementations(type); if not registered, say so up front (instead of sending a tx that will fail)
 *   1. approve only if the allowance is too low
 *   2. createProject -> sync via /api/tx (with project details and the signer key)
 *   3. Signature airdrop with a list file selected -> upload the list
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { encodeAbiParameters, isAddress, parseAbiParameters, toHex, zeroAddress } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Circle, Loader2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Stepper } from '@/components/ui/Stepper'
import { Badge } from '@/components/ui/Badge'
import { KV } from '@/components/ui/Data'
import { Notice } from '@/components/ui/Feedback'
import { TYPE_LABEL } from '@/components/project/Bits'
import { useChainTx } from '@/hooks/useChainTx'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/errors'
import { formatDateTime, formatToken, localInputToUnix, parseTokenInput, shortAddr } from '@/lib/client/format'
import { ERC20_FULL_ABI, FACTORY_WRITE_ABI } from '@/lib/abis'
import { appChain, FACTORY_ADDRESS, IMPL_TYPE, type ProjectKind } from '@/config/chain'
import { TokenStep } from './TokenStep'
import { DistributionStep, emptyVestingRow } from './DistributionStep'
import type { TokenInfo, WizardState } from './types'

const STEPS = ['Type', 'Token', 'Distribution', 'Details', 'Deploy']

const TYPES: { key: ProjectKind; desc: string; badge: 'blue' | 'green' | 'yellow'; best: string }[] = [
  { key: 'merkle', badge: 'blue', desc: 'Fixed list from a CSV, verified on-chain with Merkle proofs. Lowest gas, scales to 100k+ addresses.', best: 'Best for: snapshots, retro drops' },
  { key: 'sign', badge: 'green', desc: 'Our backend signs each claim. Edit the recipient list any time, even after launch.', best: 'Best for: quests, allowlists, ongoing rewards' },
  { key: 'vesting', badge: 'yellow', desc: 'Per-beneficiary schedules with TGE unlock, cliff and linear or stepped release.', best: 'Best for: investors, team, advisors' },
]

function initialState(): WizardState {
  const now = Math.floor(Date.now() / 1000)
  const toInput = (u: number) => new Date(u * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  return {
    type: 'merkle', token: '',
    start: toInput(now + 3600), end: toInput(now + 30 * 86400),
    merkleFile: null, merkle: null,
    signerKey: '', signerAddress: '', signerFresh: null, signerBackedUp: false, signFile: null,
    vestingMode: 'manual', vestingFile: null, vestingRows: [emptyVestingRow()], vesting: null,
    fundAmount: '', name: '', description: '', website: '', twitter: '', telegram: '',
  }
}

type DeployStep = 'approve' | 'create' | 'list'
type StepState = 'todo' | 'running' | 'done' | 'skipped'

export default function CreateWizard() {
  const { address, isConnected } = useAccount()
  const { send } = useChainTx()
  const { ensureSignedIn } = useAuth()
  const [step, setStep] = useState(0)
  const searchParams = useSearchParams()
  // /create?token=0x... pre-fills the token (e.g. from the test token page)
  const [s, setS] = useState<WizardState>(() => {
    const t = searchParams.get('token') ?? ''
    return { ...initialState(), token: isAddress(t, { strict: false }) ? t : '' }
  })
  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }))
  const [salt] = useState(() => toHex(crypto.getRandomValues(new Uint8Array(32))))
  const [deploying, setDeploying] = useState(false)
  const [progress, setProgress] = useState<Record<DeployStep, StepState>>({ approve: 'todo', create: 'todo', list: 'todo' })
  const [deployed, setDeployed] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)

  const tokenAddr = isAddress(s.token, { strict: false }) ? (s.token as `0x${string}`) : undefined
  const tokenReads = useReadContracts({
    allowFailure: false,
    contracts: tokenAddr ? [
      { address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'symbol', chainId: appChain.id },
      { address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'decimals', chainId: appChain.id },
      { address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'name', chainId: appChain.id },
      { address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'balanceOf', args: [address ?? zeroAddress], chainId: appChain.id },
    ] : [],
    query: { enabled: !!tokenAddr },
  })
  const token: TokenInfo | null = tokenReads.data
    ? { symbol: tokenReads.data[0] as string, decimals: Number(tokenReads.data[1]), name: tokenReads.data[2] as string, balance: tokenReads.data[3] as bigint }
    : null

  const impl = useReadContract({
    address: FACTORY_ADDRESS, abi: FACTORY_WRITE_ABI, functionName: 'implementations', args: [IMPL_TYPE[s.type]], chainId: appChain.id,
  })
  const predicted = useReadContract({
    address: FACTORY_ADDRESS, abi: FACTORY_WRITE_ABI, functionName: 'predictAddress',
    args: [IMPL_TYPE[s.type], address ?? zeroAddress, salt], chainId: appChain.id,
    query: { enabled: !!address && impl.data !== undefined && impl.data !== zeroAddress },
  })
  const allowance = useReadContract({
    address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'allowance', args: [address ?? zeroAddress, FACTORY_ADDRESS], chainId: appChain.id,
    query: { enabled: !!tokenAddr && !!address },
  })

  const amount = token ? parseTokenInput(s.fundAmount, token.decimals) : null

  /** Whether the current step can advance; returns null if yes, otherwise the reason */
  const blocker = useMemo((): string | null => {
    if (step === 1) {
      if (!tokenAddr) return 'Enter the token address'
      if (!token) return 'Waiting for token info'
    }
    if (step === 2 && token) {
      if (s.type === 'merkle' && !s.merkle) return 'Upload your list and build the Merkle tree'
      if (s.type === 'vesting' && !s.vesting) return 'Validate your schedules'
      if (s.type === 'sign' && !s.signerFresh) return 'Set up a brand-new signer key'
      if (s.type !== 'vesting') {
        if (!s.start || !s.end) return 'Set the claim window'
        if (localInputToUnix(s.end) <= localInputToUnix(s.start)) return 'Claim window must end after it opens'
        if (localInputToUnix(s.end) <= Date.now() / 1000) return 'Claim window must end in the future'
      }
      if (amount === null || amount === 0n) return 'Enter a deposit amount'
      if (s.type === 'merkle' && s.merkle && amount < BigInt(s.merkle.totalAmount)) return 'Deposit must cover the list total'
      if (s.type === 'vesting' && s.vesting && amount < BigInt(s.vesting.totalAmount)) return 'Deposit must cover all schedules'
      if (amount > token.balance) return 'Not enough balance'
    }
    if (step === 3 && !s.name.trim()) return 'Give your project a name'
    return null
  }, [step, s, token, tokenAddr, amount])

  function buildInitData(): `0x${string}` {
    if (s.type === 'merkle') {
      return encodeAbiParameters(parseAbiParameters('bytes32, uint64, uint64'),
        [s.merkle!.root, BigInt(localInputToUnix(s.start)), BigInt(localInputToUnix(s.end))])
    }
    if (s.type === 'sign') {
      return encodeAbiParameters(parseAbiParameters('address, uint64, uint64'),
        [s.signerAddress as `0x${string}`, BigInt(localInputToUnix(s.start)), BigInt(localInputToUnix(s.end))])
    }
    return s.vesting!.initData
  }

  async function deploy() {
    if (!token || amount === null || !tokenAddr) return
    setDeploying(true)
    setDeployError(null)
    try {
      // Signature airdrop with a list to upload: sign in first, so we don't get stuck on sign-in after the transactions are sent
      if (s.type === 'sign' && s.signFile) await ensureSignedIn()

      // 1. approve (skipped if the allowance is enough)
      if ((allowance.data ?? 0n) < amount) {
        setProgress((p) => ({ ...p, approve: 'running' }))
        await send({ label: `Approve ${token.symbol}`, request: { address: tokenAddr, abi: ERC20_FULL_ABI, functionName: 'approve', args: [FACTORY_ADDRESS, amount] }, sync: false })
        await allowance.refetch()
      }
      setProgress((p) => ({ ...p, approve: 'done' }))

      // 2. createProject + sync
      setProgress((p) => ({ ...p, create: 'running' }))
      const meta = {
        name: s.name.trim(),
        description: s.description.trim() || undefined,
        website: s.website.trim() || undefined,
        twitter: s.twitter.trim() || undefined,
        telegram: s.telegram.trim() || undefined,
      }
      const { sync } = await send({
        label: 'Create project',
        request: { address: FACTORY_ADDRESS, abi: FACTORY_WRITE_ABI, functionName: 'createProject', args: [IMPL_TYPE[s.type], tokenAddr, amount, salt, buildInitData()] },
        sync: { meta, signerPrivateKey: s.type === 'sign' ? s.signerKey : undefined },
      })
      const projectAddr = sync?.projectsCreated[0] ?? (predicted.data as string | undefined)?.toLowerCase() ?? null
      setProgress((p) => ({ ...p, create: 'done' }))

      // 3. Signature airdrop: upload the initial list
      if (s.type === 'sign' && s.signFile && projectAddr && sync) {
        setProgress((p) => ({ ...p, list: 'running' }))
        try {
          const form = new FormData()
          form.set('file', s.signFile)
          await api(`/api/projects/${projectAddr}/sign/allocations`, { form })
          setProgress((p) => ({ ...p, list: 'done' }))
        } catch (e) {
          setProgress((p) => ({ ...p, list: 'todo' }))
          setDeployError(`Project created, but the recipient list failed to upload: ${errorMessage(e)} You can upload it from the project page.`)
        }
      } else {
        setProgress((p) => ({ ...p, list: 'skipped' }))
      }
      setDeployed(projectAddr)
    } catch (e) {
      setDeployError(errorMessage(e))
      setProgress((p) => ({ approve: p.approve === 'running' ? 'todo' : p.approve, create: p.create === 'running' ? 'todo' : p.create, list: p.list }))
    } finally {
      setDeploying(false)
    }
  }

  if (!isConnected) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardBody className="py-14 text-center space-y-4">
          <h1 className="font-display font-semibold text-xl text-ink">Create a distribution</h1>
          <p className="text-sm text-muted">Connect the wallet that holds the tokens you want to distribute.</p>
          <div className="flex justify-center"><ConnectKitButton /></div>
        </CardBody>
      </Card>
    )
  }

  if (deployed) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardBody className="py-12 text-center space-y-4">
          <div className="w-12 h-12 bg-green-light rounded-full flex items-center justify-center mx-auto"><Check className="text-green-text" /></div>
          <h2 className="font-display font-semibold text-xl text-ink">{s.name} is live</h2>
          <p className="font-mono-data text-xs text-muted">{deployed}</p>
          {deployError && <Notice tone="warning" className="text-left">{deployError}</Notice>}
          <div className="flex justify-center gap-2">
            <Link href={`/projects/${deployed}`} className="inline-flex items-center gap-2 px-4 py-2 rounded-btn bg-ink text-white text-sm font-medium">Open project <ArrowRight size={14} /></Link>
            <Button variant="secondary" onClick={() => { setS(initialState()); setStep(0); setDeployed(null); setProgress({ approve: 'todo', create: 'todo', list: 'todo' }) }}>Create another</Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  const implMissing = impl.data === zeroAddress

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Create project</h1>
        <p className="text-muted text-sm mt-1">Deploy a token distribution contract in one transaction.</p>
      </div>
      <Stepper steps={STEPS} current={step} />

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
          <Card>
            {step === 0 && (
              <>
                <CardHeader><h2 className="font-display font-semibold text-ink">Choose a distribution type</h2></CardHeader>
                <CardBody className="space-y-3">
                  {TYPES.map((t) => (
                    <button key={t.key} onClick={() => patch({ type: t.key })}
                      className={`w-full text-left p-4 rounded-btn border transition-colors ${s.type === t.key ? 'border-ink bg-ink/[0.04]' : 'border-border hover:border-ink/30'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-ink">{TYPE_LABEL[t.key]}</span>
                        <Badge variant={t.badge}>{s.type === t.key ? 'Selected' : t.key}</Badge>
                      </div>
                      <p className="text-xs text-muted mt-1 leading-relaxed">{t.desc}</p>
                      <p className="text-xs text-ink/70 mt-1">{t.best}</p>
                    </button>
                  ))}
                </CardBody>
              </>
            )}
            {step === 1 && <TokenStep s={s} patch={patch} token={token} loading={tokenReads.isLoading} />}
            {step === 2 && token && <DistributionStep s={s} patch={patch} token={token} />}
            {step === 3 && (
              <>
                <CardHeader><h2 className="font-display font-semibold text-ink">Project details</h2></CardHeader>
                <CardBody className="space-y-4">
                  <Input label="Project name" placeholder="e.g. Season 1 community airdrop" maxLength={120} value={s.name} onChange={(e) => patch({ name: e.target.value })} />
                  <Textarea label="Description (optional)" rows={3} maxLength={5000} value={s.description} onChange={(e) => patch({ description: e.target.value })}
                    placeholder="Tell recipients what this distribution is for." />
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Input label="Website" placeholder="https://…" value={s.website} onChange={(e) => patch({ website: e.target.value })} />
                    <Input label="X / Twitter" placeholder="@handle" value={s.twitter} onChange={(e) => patch({ twitter: e.target.value })} />
                    <Input label="Telegram" placeholder="t.me/…" value={s.telegram} onChange={(e) => patch({ telegram: e.target.value })} />
                  </div>
                  <p className="text-xs text-muted">Shown on the public project page. You can edit these later.</p>
                </CardBody>
              </>
            )}
            {step === 4 && token && amount !== null && (
              <>
                <CardHeader><h2 className="font-display font-semibold text-ink">Review & deploy</h2></CardHeader>
                <CardBody className="space-y-5">
                  <div>
                    <KV label="Name">{s.name}</KV>
                    <KV label="Type">{TYPE_LABEL[s.type]}</KV>
                    <KV label="Deposit">{formatToken(amount, token.decimals)} {token.symbol}</KV>
                    {s.type === 'merkle' && s.merkle && <KV label="Recipients">{s.merkle.totalEntries.toLocaleString('en-US')}</KV>}
                    {s.type === 'vesting' && s.vesting && <KV label="Schedules">{s.vesting.count}</KV>}
                    {s.type === 'sign' && <KV label="Signer" mono>{shortAddr(s.signerAddress, 10, 8)}</KV>}
                    {s.type === 'sign' && <KV label="Initial list">{s.signFile ? s.signFile.name : 'Upload later'}</KV>}
                    {s.type !== 'vesting' && <KV label="Claim window">{formatDateTime(localInputToUnix(s.start))} → {formatDateTime(localInputToUnix(s.end))}</KV>}
                    {predicted.data && <KV label="Project address" mono>{predicted.data}</KV>}
                  </div>

                  {implMissing && (
                    <Notice tone="error" title="This distribution type is not available yet">
                      The factory on {appChain.name} has no contract registered for {TYPE_LABEL[s.type]}. The platform owner must call setImplementation first.
                    </Notice>
                  )}

                  <ol className="space-y-2 text-sm">
                    <DeployLine state={progress.approve} label={`Approve ${token.symbol}`} note={(allowance.data ?? 0n) >= amount ? 'already approved' : undefined} />
                    <DeployLine state={progress.create} label="Create project & sync" />
                    {s.type === 'sign' && s.signFile && <DeployLine state={progress.list} label="Upload recipient list" />}
                  </ol>

                  {deployError && <Notice tone="error">{deployError}</Notice>}
                  <Button onClick={deploy} loading={deploying} disabled={implMissing || impl.isLoading} className="w-full" size="lg">
                    {progress.create === 'done' ? 'Retry' : 'Deploy'}
                  </Button>
                  <p className="text-xs text-muted text-center">Deposited tokens can only be withdrawn according to the contract rules.</p>
                </CardBody>
              </>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || deploying}>
          <ArrowLeft size={14} /> Back
        </Button>
        {step < 4 && (
          <div className="flex items-center gap-3">
            {blocker && <span className="text-xs text-muted hidden sm:block">{blocker}</span>}
            <Button onClick={() => setStep(step + 1)} disabled={!!blocker}>Next <ArrowRight size={14} /></Button>
          </div>
        )}
      </div>
    </div>
  )
}

function DeployLine({ state, label, note }: { state: StepState; label: string; note?: string }) {
  return (
    <li className="flex items-center gap-2">
      {state === 'done' ? <Check size={15} className="text-green-text" />
        : state === 'running' ? <Loader2 size={15} className="animate-spin text-ink" />
        : <Circle size={15} className="text-border" />}
      <span className={state === 'done' ? 'text-ink' : 'text-muted'}>{label}</span>
      {note && state === 'todo' && <span className="text-xs text-muted">({note})</span>}
      {state === 'skipped' && <span className="text-xs text-muted">(skipped)</span>}
    </li>
  )
}
