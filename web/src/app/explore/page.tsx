'use client'
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { Tabs, Pager } from '@/components/ui/Tabs'
import { ProjectRow } from '@/components/project/ProjectRow'
import { useProjects } from '@/hooks/queries'

type Filter = '' | 'merkle' | 'sign' | 'vesting'

export default function ExplorePage() {
  const [type, setType] = useState<Filter>('')
  const [page, setPage] = useState(1)
  const q = useProjects({ type, page, pageSize: 20 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink tracking-tight-display">Explore projects</h1>
        <p className="text-muted text-sm mt-1">Every distribution created on TokenDis.</p>
      </div>
      <Tabs<Filter>
        value={type}
        onChange={(v) => { setType(v); setPage(1) }}
        tabs={[{ key: '', label: 'All' }, { key: 'merkle', label: 'Merkle' }, { key: 'sign', label: 'Signature' }, { key: 'vesting', label: 'Vesting' }]}
      />
      {q.isLoading ? <Loading /> : q.data?.items.length ? (
        <div className="space-y-2">
          {q.data.items.map((p) => <ProjectRow key={p.address} p={p} />)}
          <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
        </div>
      ) : <Card><EmptyState title="Nothing here yet" /></Card>}
    </div>
  )
}
