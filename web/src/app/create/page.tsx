import { Suspense } from 'react'
import CreateWizard from '@/components/create/CreateWizard'

export const metadata = { title: 'Create project' }

export default function CreatePage() {
  // CreateWizard reads ?token= via useSearchParams, which needs a Suspense boundary
  return (
    <Suspense>
      <CreateWizard />
    </Suspense>
  )
}
