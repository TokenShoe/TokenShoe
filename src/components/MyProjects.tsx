import { useAccount, useReadContract } from 'wagmi'
import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import { formatUnits } from 'viem'
import { Card, CardBody } from './ui/Card'
import { Badge } from './ui/Badge'
import { CONTRACTS, ARC_EXPLORER, arcTestnet } from '../config/wagmi'
import { FACTORY_ABI, VESTING_ABI, ERC20_ABI } from '../config/abis'

export default function MyProjects() {
  const { address } = useAccount()

  const { data: projects, isLoading } = useReadContract({
    address: CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'projectsOf',
    args: [address!],
    query: { enabled: !!address },
    chainId: arcTestnet.id,
  })

  const list = (projects as `0x${string}`[] | undefined) ?? []

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">My projects</h1>
        <p className="text-muted text-sm mt-1">{list.length} project{list.length !== 1 ? 's' : ''} created by your address.</p>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted text-sm">Loading…</div>
      )}

      {!isLoading && list.length === 0 && (
        <Card>
          <CardBody className="py-12 text-center text-muted text-sm">
            You haven't created any projects yet.
          </CardBody>
        </Card>
      )}

      <div className="space-y-3">
        {list.map((addr, i) => (
          <motion.div
            key={addr}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <ProjectRow address={addr} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ProjectRow({ address: projectAddr }: { address: `0x${string}` }) {
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

  const dec = (tokenDecimals as number | undefined) ?? 18
  const sym = (tokenSymbol as string | undefined) ?? ''
  const funded = totalFunded ? formatUnits(totalFunded as bigint, dec) : '—'
  const claimed = totalClaimed ? formatUnits(totalClaimed as bigint, dec) : '—'

  return (
    <Card>
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Badge variant="yellow">vesting</Badge>
          <span className="font-mono-data text-xs text-muted truncate">
            {projectAddr.slice(0, 12)}…{projectAddr.slice(-6)}
          </span>
        </div>
        <div className="flex items-center gap-6 shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-muted">Funded</div>
            <div className="font-mono-data text-sm text-ink">{funded} {sym}</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-muted">Claimed</div>
            <div className="font-mono-data text-sm text-ink">{claimed} {sym}</div>
          </div>
          <a
            href={`${ARC_EXPLORER}/address/${projectAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-blue transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </Card>
  )
}
