import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { CONTRACTS, ARC_EXPLORER, arcTestnet } from '../config/wagmi'
import { FACTORY_ABI, VESTING_ABI, ERC20_ABI } from '../config/abis'
import { formatUnits } from 'viem'

export default function ClaimPage() {
  const { address } = useAccount()
  const [selectedProject, setSelectedProject] = useState<`0x${string}` | null>(null)

  const { data: projects, isLoading, refetch } = useReadContract({
    address: CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'projectsOf',
    args: [address!],
    query: { enabled: !!address },
    chainId: arcTestnet.id,
  })

  const projectList = (projects as `0x${string}`[] | undefined) ?? []

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Claim tokens</h1>
          <p className="text-muted text-sm mt-1">Projects where you have vesting schedules.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted text-sm">Loading projects…</div>
      )}

      {!isLoading && projectList.length === 0 && (
        <Card>
          <CardBody className="py-12 text-center text-muted text-sm">
            No projects found for your address.
          </CardBody>
        </Card>
      )}

      <div className="space-y-3">
        {projectList.map((addr, i) => (
          <motion.div
            key={addr}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <ProjectCard
              address={addr}
              selected={selectedProject === addr}
              onSelect={() => setSelectedProject(selectedProject === addr ? null : addr)}
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  address: projectAddr,
  selected,
  onSelect,
}: {
  address: `0x${string}`
  selected: boolean
  onSelect: () => void
}) {
  const { address: userAddr } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [claimTx, setClaimTx] = useState<`0x${string}` | undefined>()
  const [isClaiming, setIsClaiming] = useState(false)

  const { data: token } = useReadContract({
    address: projectAddr,
    abi: VESTING_ABI,
    functionName: 'token',
    chainId: arcTestnet.id,
  })
  const { data: totalFunded } = useReadContract({
    address: projectAddr,
    abi: VESTING_ABI,
    functionName: 'totalFunded',
    chainId: arcTestnet.id,
  })
  const { data: totalClaimed } = useReadContract({
    address: projectAddr,
    abi: VESTING_ABI,
    functionName: 'totalClaimed',
    chainId: arcTestnet.id,
  })
  const { data: scheduleIds } = useReadContract({
    address: projectAddr,
    abi: VESTING_ABI,
    functionName: 'schedulesOf',
    args: [userAddr!],
    query: { enabled: !!userAddr },
    chainId: arcTestnet.id,
  })
  const { data: tokenSymbol } = useReadContract({
    address: token as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: 'symbol',
    query: { enabled: !!token },
    chainId: arcTestnet.id,
  })
  const { data: tokenDecimals } = useReadContract({
    address: token as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!token },
    chainId: arcTestnet.id,
  })

  const { isLoading: waitingClaim } = useWaitForTransactionReceipt({ hash: claimTx })

  const ids = (scheduleIds as bigint[] | undefined) ?? []
  const dec = (tokenDecimals as number | undefined) ?? 18
  const sym = (tokenSymbol as string | undefined) ?? ''
  const funded = totalFunded ? formatUnits(totalFunded as bigint, dec) : '—'
  const claimed = totalClaimed ? formatUnits(totalClaimed as bigint, dec) : '—'

  async function handleClaim() {
    if (ids.length === 0) return
    setIsClaiming(true)
    try {
      const tx = await writeContractAsync({
        address: projectAddr,
        abi: VESTING_ABI,
        functionName: 'claim',
        args: [ids],
        chainId: arcTestnet.id,
      })
      setClaimTx(tx)
      toast.success('Claim submitted!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg.slice(0, 120))
    } finally {
      setIsClaiming(false)
    }
  }

  const isLoading = isClaiming || waitingClaim

  return (
    <Card>
      <button
        onClick={onSelect}
        className="w-full text-left px-6 py-4 flex items-center justify-between hover:bg-black/[0.02] transition-colors rounded-card"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge variant="yellow">vesting</Badge>
          <span className="font-mono-data text-xs text-muted truncate">
            {projectAddr.slice(0, 10)}…{projectAddr.slice(-6)}
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-muted">Funded</div>
            <div className="font-mono-data text-sm text-ink">{funded} {sym}</div>
          </div>
          <a
            href={`${ARC_EXPLORER}/address/${projectAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted hover:text-blue transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </button>

      {selected && (
        <div className="border-t border-border px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Stat label="Total funded" value={`${funded} ${sym}`} />
            <Stat label="Total claimed" value={`${claimed} ${sym}`} />
            <Stat label="My schedules" value={String(ids.length)} />
          </div>

          {ids.length > 0 ? (
            <Button onClick={handleClaim} loading={isLoading} className="w-full">
              Claim all available
            </Button>
          ) : (
            <p className="text-sm text-muted text-center py-2">
              No vesting schedules found for your address on this contract.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono-data text-sm text-ink mt-0.5">{value}</div>
    </div>
  )
}
