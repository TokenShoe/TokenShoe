'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight, Layers, Send, Lock, Sparkles } from 'lucide-react'
import { LinkButton } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/Data'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { DailyBars } from '@/components/charts/DailyBars'
import { ProjectRow } from '@/components/project/ProjectRow'
import { useDailyStats, useProjects, useStats } from '@/hooks/queries'
import { formatCompact, plural } from '@/lib/client/format'
import { isDeployed } from '@/config/networks'
import { useNetwork } from '@/hooks/useNetwork'

type Metric = 'claims' | 'newClaimers' | 'projectsCreated'
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'claims', label: 'Claims', unit: 'claims' },
  { key: 'newClaimers', label: 'New claimers', unit: 'new claimers' },
  { key: 'projectsCreated', label: 'Projects', unit: 'projects created' },
]

const FEATURES = [
  { icon: Layers, title: 'Merkle airdrop', desc: 'Upload a CSV of addresses and amounts. One Merkle root on-chain, scales to 100k+ recipients.', cls: 'bg-blue-light text-blue-text' },
  { icon: Send, title: 'Signature airdrop', desc: 'Edit the recipient list any time. Our backend signs each claim with your dedicated signer key.', cls: 'bg-green-light text-green-text' },
  { icon: Lock, title: 'Vesting', desc: 'TGE unlock, cliff and linear or stepped release for investors, team and advisors.', cls: 'bg-yellow-light text-yellow-text' },
]

export default function Home() {
  const { network } = useNetwork()
  const stats = useStats()
  const daily = useDailyStats(30)
  const recent = useProjects({ pageSize: 5 })
  const [metric, setMetric] = useState<Metric>('claims')
  const m = METRICS.find((x) => x.key === metric)!

  return (
    <div className="space-y-14">
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="pt-6 space-y-5 max-w-2xl"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-light text-blue-text text-xs font-medium rounded-full tracking-wide uppercase">
          {network.label} · {isDeployed(network) ? 'Live' : 'Coming soon'}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink tracking-tight-display leading-[1.1]">
          Token distribution,<br />without the overhead
        </h1>
        <p className="text-muted text-lg leading-relaxed max-w-lg">
          Deploy a Merkle airdrop, signature-gated drop or vesting schedule in a single transaction.
          Recipients claim what&apos;s theirs — creators can&apos;t pull it back early.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <LinkButton href="/create" size="lg">Create a project <ArrowRight size={14} /></LinkButton>
          <LinkButton href="/claim" variant="secondary" size="lg">Check my airdrops</LinkButton>
        </div>
        {network.testTokenFactory && (
          <Link href="/test-token" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors">
            <Sparkles size={14} className="text-blue-text" />
            Just exploring? Mint a test token to try it out <ArrowRight size={12} />
          </Link>
        )}
      </motion.section>

      <section className="space-y-4">
        <h2 className="font-display font-semibold text-ink">Platform activity</h2>
        {stats.data ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Projects" value={formatCompact(stats.data.totalProjects)}
              sub={`${stats.data.totalMerkle} Merkle · ${stats.data.totalSign} signature · ${stats.data.totalVesting} vesting`} />
            <StatTile label="Claims" value={formatCompact(stats.data.totalClaims)} sub="Successful claim transactions" />
            <StatTile label="Claimers" value={formatCompact(stats.data.totalClaimers)} sub="Unique addresses that claimed" />
            <StatTile label="Recipients" value={formatCompact(stats.data.totalRecipients)} sub={`Across all lists · ${plural(stats.data.totalCreators, 'creator')}`} />
          </div>
        ) : stats.isLoading ? <Loading /> : null}

        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-ink text-sm">{m.label} per day</div>
                <div className="text-xs text-muted">Last 30 days, UTC</div>
              </div>
              <div className="flex gap-1 bg-black/[0.04] p-0.5 rounded-btn">
                {METRICS.map((x) => (
                  <button key={x.key} onClick={() => setMetric(x.key)}
                    className={`px-2.5 py-1 text-xs rounded-[5px] font-medium transition-colors ${metric === x.key ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            {daily.data ? (
              <DailyBars unit={m.unit} data={daily.data.items.map((d) => ({ day: d.day, value: d[metric] }))} />
            ) : <Loading />}
          </CardBody>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-ink">Latest projects</h2>
          <LinkButton href="/explore" variant="ghost" size="sm">View all <ArrowRight size={12} /></LinkButton>
        </div>
        {recent.isLoading ? <Loading /> : recent.data?.items.length ? (
          <div className="space-y-2">{recent.data.items.map((p) => <ProjectRow key={p.address} p={p} />)}</div>
        ) : (
          <Card><EmptyState title="No projects yet" action={<LinkButton href="/create" size="sm">Create the first one</LinkButton>} /></Card>
        )}
      </section>

      <section className="grid sm:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-surface border border-border rounded-card p-6 shadow-card">
            <div className={`w-9 h-9 rounded-[8px] ${f.cls} flex items-center justify-center mb-4`}><f.icon size={18} /></div>
            <h3 className="font-display font-semibold text-ink mb-2">{f.title}</h3>
            <p className="text-muted text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
