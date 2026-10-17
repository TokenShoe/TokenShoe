'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/Button'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { Pager } from '@/components/ui/Tabs'
import { ProjectRow } from '@/components/project/ProjectRow'
import { useProjects } from '@/hooks/queries'

export default function MyProjectsPage() {
  const { address, isConnected } = useAccount()
  const [page, setPage] = useState(1)
  const q = useProjects({ creator: address?.toLowerCase(), page, pageSize: 20 }, !!address)

  if (!isConnected) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardBody className="py-14 text-center space-y-4">
          <h1 className="font-display font-semibold text-xl text-ink">My projects</h1>
          <p className="text-sm text-muted">Connect your wallet to manage the distributions you created.</p>
          <div className="flex justify-center"><ConnectKitButton /></div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">My projects</h1>
          <p className="text-muted text-sm mt-1">Distributions created by your wallet.</p>
        </div>
        <LinkButton href="/create" size="sm"><Plus size={14} /> New project</LinkButton>
      </div>
      {q.isLoading ? <Loading /> : q.data?.items.length ? (
        <div className="space-y-2">
          {q.data.items.map((p) => <ProjectRow key={p.address} p={p} />)}
          <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
        </div>
      ) : (
        <Card><EmptyState title="You haven't created a project yet" action={<LinkButton href="/create" size="sm">Create your first project</LinkButton>} /></Card>
      )}
    </div>
  )
}
