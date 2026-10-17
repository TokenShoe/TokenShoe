import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { encodeAbiParameters, keccak256, toBytes, parseUnits, parseAbiParameters } from 'viem'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { Stepper } from './ui/Stepper'
import { Badge } from './ui/Badge'
import { CONTRACTS, IMPL_TYPES, ARC_EXPLORER, arcTestnet } from '../config/wagmi'
import { FACTORY_ABI, ERC20_ABI } from '../config/abis'

const STEPS = ['Type', 'Token', 'Parameters', 'Review & Deploy']

type ProjectType = 'merkle' | 'sign' | 'vesting'

interface BaseForm {
  type: ProjectType
  token: string
  amount: string
}

interface MerkleParams {
  root: string
  startTime: string
  endTime: string
}

interface SignParams {
  signer: string
  startTime: string
  endTime: string
}

interface VestingSchedule {
  beneficiary: string
  totalAmount: string
  tgeTime: string
  tgeBps: string
  cliffDays: string
  vestingDays: string
  intervalDays: string
  revocable: boolean
}

export default function CreateWizard() {
  const { address } = useAccount()
  const [step, setStep] = useState(0)
  const [base, setBase] = useState<BaseForm>({ type: 'merkle', token: '', amount: '' })
  const [merkle, setMerkle] = useState<MerkleParams>({ root: '', startTime: '', endTime: '' })
  const [sign, setSign] = useState<SignParams>({ signer: '', startTime: '', endTime: '' })
  const [vestingRows, setVestingRows] = useState<VestingSchedule[]>([defaultVestingRow()])
  const [userSalt] = useState<`0x${string}`>(() => keccak256(toBytes(Math.random().toString())))
  const [predictedAddr, setPredictedAddr] = useState<string | null>(null)
  const [deployedAddr, setDeployedAddr] = useState<string | null>(null)

  const implType =
    base.type === 'merkle' ? IMPL_TYPES.MERKLE :
    base.type === 'sign' ? IMPL_TYPES.SIGN :
    IMPL_TYPES.VESTING

  // Read token info
  const { data: tokenSymbol } = useReadContract({
    address: base.token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'symbol',
    query: { enabled: base.token.startsWith('0x') && base.token.length === 42 },
    chainId: arcTestnet.id,
  })
  const { data: tokenDecimals } = useReadContract({
    address: base.token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: base.token.startsWith('0x') && base.token.length === 42 },
    chainId: arcTestnet.id,
  })

  // Predict address
  const { data: predicted } = useReadContract({
    address: CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'predictAddress',
    args: [implType, address!, userSalt],
    query: { enabled: !!address && step >= 2 },
    chainId: arcTestnet.id,
  })

  if (predicted && predicted !== predictedAddr) setPredictedAddr(predicted as string)

  // Approve + create
  const { writeContractAsync } = useWriteContract()
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>()
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | undefined>()
  const [isDeploying, setIsDeploying] = useState(false)

  const { isLoading: waitingApprove } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: waitingCreate } = useWaitForTransactionReceipt({ hash: createTxHash })

  function buildInitData(): `0x${string}` {
    if (base.type === 'merkle') {
      const start = BigInt(Math.floor(new Date(merkle.startTime).getTime() / 1000))
      const end = BigInt(Math.floor(new Date(merkle.endTime).getTime() / 1000))
      return encodeAbiParameters(
        parseAbiParameters('bytes32 root, uint64 startTime, uint64 endTime'),
        [merkle.root as `0x${string}`, start, end],
      )
    }
    if (base.type === 'sign') {
      const start = BigInt(Math.floor(new Date(sign.startTime).getTime() / 1000))
      const end = BigInt(Math.floor(new Date(sign.endTime).getTime() / 1000))
      return encodeAbiParameters(
        parseAbiParameters('address signer, uint64 startTime, uint64 endTime'),
        [sign.signer as `0x${string}`, start, end],
      )
    }
    // Vesting: encode Schedule[] — simplified single-schedule for MVP
    const dec = tokenDecimals ?? 18
    const schedules = vestingRows.map((r) => ({
      beneficiary: r.beneficiary as `0x${string}`,
      totalAmount: parseUnits(r.totalAmount || '0', dec),
      claimed: 0n,
      revokedClaimableCap: 0n,
      tgeTime: BigInt(Math.floor(new Date(r.tgeTime).getTime() / 1000)),
      tgeBps: Number(r.tgeBps),
      cliffDuration: BigInt(Number(r.cliffDays) * 86400),
      vestingDuration: BigInt(Number(r.vestingDays) * 86400),
      interval: Number(r.intervalDays) * 86400,
      revocable: r.revocable,
      revoked: false,
    }))
    return encodeAbiParameters(
      parseAbiParameters(
        '(address beneficiary, uint256 totalAmount, uint256 claimed, uint256 revokedClaimableCap, uint64 tgeTime, uint16 tgeBps, uint64 cliffDuration, uint64 vestingDuration, uint32 interval, bool revocable, bool revoked)[] schedules',
      ),
      [schedules],
    )
  }

  async function handleDeploy() {
    if (!address) return
    setIsDeploying(true)
    try {
      const dec = tokenDecimals ?? 18
      const amt = parseUnits(base.amount, dec)

      // 1. Approve factory
      toast.loading('Approving token transfer…', { id: 'deploy' })
      const approveTx = await writeContractAsync({
        address: base.token as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.factory, amt],
        chainId: arcTestnet.id,
      })
      setApproveTxHash(approveTx)

      // 2. Create project
      toast.loading('Creating project…', { id: 'deploy' })
      const initData = buildInitData()
      const createTx = await writeContractAsync({
        address: CONTRACTS.factory,
        abi: FACTORY_ABI,
        functionName: 'createProject',
        args: [implType, base.token as `0x${string}`, amt, userSalt, initData],
        chainId: arcTestnet.id,
      })
      setCreateTxHash(createTx)
      setDeployedAddr(predictedAddr)
      toast.success('Project deployed!', { id: 'deploy' })
      setStep(4) // success screen
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg.slice(0, 120), { id: 'deploy' })
    } finally {
      setIsDeploying(false)
    }
  }

  const isLoading = isDeploying || waitingApprove || waitingCreate

  if (step === 4) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardBody className="py-12 text-center space-y-4">
          <div className="w-12 h-12 bg-green-light rounded-full flex items-center justify-center mx-auto">
            <span className="text-green-text text-xl">✓</span>
          </div>
          <h2 className="font-display font-semibold text-xl text-ink">Project deployed!</h2>
          {deployedAddr && (
            <a
              href={`${ARC_EXPLORER}/address/${deployedAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue hover:underline font-mono-data"
            >
              {deployedAddr.slice(0, 10)}…{deployedAddr.slice(-8)}
              <ExternalLink size={12} />
            </a>
          )}
          <Button variant="secondary" onClick={() => { setStep(0); setDeployedAddr(null) }}>
            Create another
          </Button>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Create project</h1>
        <p className="text-muted text-sm mt-1">Deploy a token distribution contract in one transaction.</p>
      </div>

      <Stepper steps={STEPS} current={step} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          <Card>
            {step === 0 && (
              <>
                <CardHeader>
                  <h2 className="font-display font-semibold text-ink">Choose distribution type</h2>
                </CardHeader>
                <CardBody className="space-y-3">
                  {([
                    { key: 'merkle', label: 'Merkle Airdrop', desc: 'Fixed list, Merkle proof verification, low gas.', badge: 'blue' as const },
                    { key: 'sign', label: 'Signature Airdrop', desc: 'Dynamic list, backend signs each claim.', badge: 'green' as const },
                    { key: 'vesting', label: 'Vesting / Unlock', desc: 'Investor / team schedules with cliff & linear unlock.', badge: 'yellow' as const },
                  ] as const).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setBase({ ...base, type: t.key })}
                      className={`w-full text-left p-4 rounded-btn border transition-colors ${
                        base.type === t.key
                          ? 'border-ink bg-ink/5'
                          : 'border-border hover:border-ink/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-ink">{t.label}</span>
                        <Badge variant={t.badge}>{t.key}</Badge>
                      </div>
                      <p className="text-xs text-muted mt-1">{t.desc}</p>
                    </button>
                  ))}
                </CardBody>
              </>
            )}

            {step === 1 && (
              <>
                <CardHeader>
                  <h2 className="font-display font-semibold text-ink">Token & amount</h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <Input
                    label="Token address"
                    placeholder="0x…"
                    value={base.token}
                    onChange={(e) => setBase({ ...base, token: e.target.value })}
                    hint={tokenSymbol ? `Detected: ${tokenSymbol}` : undefined}
                  />
                  <Input
                    label={`Amount to deposit${tokenSymbol ? ` (${tokenSymbol})` : ''}`}
                    placeholder="1000000"
                    type="number"
                    min="0"
                    value={base.amount}
                    onChange={(e) => setBase({ ...base, amount: e.target.value })}
                    hint="You must approve this amount before deploying."
                  />
                </CardBody>
              </>
            )}

            {step === 2 && base.type === 'merkle' && (
              <>
                <CardHeader>
                  <h2 className="font-display font-semibold text-ink">Merkle parameters</h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <Input
                    label="Merkle root"
                    placeholder="0x…"
                    value={merkle.root}
                    onChange={(e) => setMerkle({ ...merkle, root: e.target.value })}
                    hint="Generate with @openzeppelin/merkle-tree (double-hash, abi.encode(index, account, amount))."
                  />
                  <Input
                    label="Start time"
                    type="datetime-local"
                    value={merkle.startTime}
                    onChange={(e) => setMerkle({ ...merkle, startTime: e.target.value })}
                  />
                  <Input
                    label="End time"
                    type="datetime-local"
                    value={merkle.endTime}
                    onChange={(e) => setMerkle({ ...merkle, endTime: e.target.value })}
                  />
                </CardBody>
              </>
            )}

            {step === 2 && base.type === 'sign' && (
              <>
                <CardHeader>
                  <h2 className="font-display font-semibold text-ink">Signature parameters</h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <Input
                    label="Signer address"
                    placeholder="0x…"
                    value={sign.signer}
                    onChange={(e) => setSign({ ...sign, signer: e.target.value })}
                    hint="The backend address that will sign EIP-712 claim requests."
                  />
                  <Input
                    label="Start time"
                    type="datetime-local"
                    value={sign.startTime}
                    onChange={(e) => setSign({ ...sign, startTime: e.target.value })}
                  />
                  <Input
                    label="End time"
                    type="datetime-local"
                    value={sign.endTime}
                    onChange={(e) => setSign({ ...sign, endTime: e.target.value })}
                  />
                </CardBody>
              </>
            )}

            {step === 2 && base.type === 'vesting' && (
              <>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-ink">Vesting schedules</h2>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setVestingRows([...vestingRows, defaultVestingRow()])}
                    >
                      + Add row
                    </Button>
                  </div>
                </CardHeader>
                <CardBody className="space-y-6">
                  {vestingRows.map((row, i) => (
                    <div key={i} className="border border-border rounded-btn p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted uppercase tracking-wide">Schedule {i + 1}</span>
                        {vestingRows.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setVestingRows(vestingRows.filter((_, j) => j !== i))}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <Input
                        label="Beneficiary"
                        placeholder="0x…"
                        value={row.beneficiary}
                        onChange={(e) => updateRow(i, 'beneficiary', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          label={`Amount${tokenSymbol ? ` (${tokenSymbol})` : ''}`}
                          type="number"
                          placeholder="100000"
                          value={row.totalAmount}
                          onChange={(e) => updateRow(i, 'totalAmount', e.target.value)}
                        />
                        <Input
                          label="TGE %"
                          type="number"
                          min="0"
                          max="100"
                          placeholder="10"
                          value={row.tgeBps ? String(Number(row.tgeBps) / 100) : ''}
                          onChange={(e) => updateRow(i, 'tgeBps', String(Math.round(Number(e.target.value) * 100)))}
                        />
                      </div>
                      <Input
                        label="TGE date"
                        type="datetime-local"
                        value={row.tgeTime}
                        onChange={(e) => updateRow(i, 'tgeTime', e.target.value)}
                      />
                      <div className="grid grid-cols-3 gap-3">
                        <Input
                          label="Cliff (days)"
                          type="number"
                          min="0"
                          placeholder="180"
                          value={row.cliffDays}
                          onChange={(e) => updateRow(i, 'cliffDays', e.target.value)}
                        />
                        <Input
                          label="Vest (days)"
                          type="number"
                          min="0"
                          placeholder="360"
                          value={row.vestingDays}
                          onChange={(e) => updateRow(i, 'vestingDays', e.target.value)}
                        />
                        <Input
                          label="Interval (days, 0=continuous)"
                          type="number"
                          min="0"
                          placeholder="30"
                          value={row.intervalDays}
                          onChange={(e) => updateRow(i, 'intervalDays', e.target.value)}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.revocable}
                          onChange={(e) => updateRow(i, 'revocable', e.target.checked)}
                          className="rounded"
                        />
                        Revocable
                      </label>
                    </div>
                  ))}
                </CardBody>
              </>
            )}

            {step === 3 && (
              <>
                <CardHeader>
                  <h2 className="font-display font-semibold text-ink">Review & deploy</h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <Row label="Type" value={base.type} />
                    <Row label="Token" value={`${base.amount} ${tokenSymbol ?? ''}`} />
                    <Row label="Token address" value={base.token} mono />
                    {predictedAddr && (
                      <Row label="Predicted address" value={predictedAddr} mono />
                    )}
                  </div>
                  <div className="bg-yellow-light text-yellow-text text-xs rounded-btn p-3 leading-relaxed">
                    You will be asked to sign two transactions: first an ERC-20 approval, then the project creation. Keep your wallet open.
                  </div>
                  <Button onClick={handleDeploy} loading={isLoading} className="w-full" size="lg">
                    Approve & Deploy
                  </Button>
                </CardBody>
              </>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* Nav buttons */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ArrowLeft size={14} /> Back
        </Button>
        {step < 3 && (
          <Button onClick={() => setStep(step + 1)}>
            Next <ArrowRight size={14} />
          </Button>
        )}
      </div>
    </div>
  )

  function updateRow(i: number, key: keyof VestingSchedule, val: string | boolean) {
    const rows = [...vestingRows]
    rows[i] = { ...rows[i], [key]: val }
    setVestingRows(rows)
  }
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border last:border-0">
      <span className="text-muted shrink-0">{label}</span>
      <span className={`text-ink text-right truncate ${mono ? 'font-mono-data text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function defaultVestingRow(): VestingSchedule {
  return {
    beneficiary: '',
    totalAmount: '',
    tgeTime: '',
    tgeBps: '0',
    cliffDays: '180',
    vestingDays: '360',
    intervalDays: '30',
    revocable: false,
  }
}
