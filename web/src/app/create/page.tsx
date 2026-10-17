import { Suspense } from 'react'
import CreateWizard from '@/components/create/CreateWizard'
import { RequireDeployed } from '@/components/layout/NotDeployedBanner'

export const metadata = { title: 'Create project' }

export default function CreatePage() {
  // CreateWizard reads ?token= via useSearchParams, which needs a Suspense boundary
  return (
    <RequireDeployed>
      <Suspense>
        <CreateWizard />
      </Suspense>
    </RequireDeployed>
  )
}
