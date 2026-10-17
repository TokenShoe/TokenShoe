/**
 * GET   /api/projects/:address  - project details (including stats and current status)
 * PATCH /api/projects/:address  - update display info (project creator only, sign-in required)
 *        Body: { name?, description?, logoUrl?, website?, twitter?, telegram? }
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects, projectStats, signSigners } from '@/db/schema'
import { ApiError, json, parseBody, route, zAddress, zProjectMeta } from '@/lib/http'
import { getProjectOr404, requireCreator } from '@/lib/auth'
import { projectView } from '@/lib/views'

export const dynamic = 'force-dynamic'

type Ctx = { params: { address: string } }

export const GET = route<Ctx>('projects.get', async (_req, { params }) => {
  const address = zAddress.parse(params.address)
  const project = await getProjectOr404(address)
  const [[stats], [signer]] = await Promise.all([
    db().select().from(projectStats).where(eq(projectStats.projectAddress, address)),
    project.type === 'sign'
      ? db().select({ signerAddress: signSigners.signerAddress }).from(signSigners).where(eq(signSigners.projectAddress, address))
      : Promise.resolve([]),
  ])
  return json({
    ...projectView(project, stats),
    // Signature airdrop: whether the backend holds a signer key matching the on-chain signer (if false, users cannot claim)
    signerReady: project.type === 'sign' ? signer?.signerAddress === project.signerAddress : undefined,
  })
})

export const PATCH = route<Ctx>('projects.patch', async (req, { params }) => {
  const address = zAddress.parse(params.address)
  await requireCreator(req, address)
  const meta = await parseBody(req, zProjectMeta)
  if (Object.keys(meta).length === 0) throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Nothing to update')
  if (meta.name !== undefined && !meta.name) throw new ApiError(400, 'NAME_REQUIRED', 'Project name cannot be empty')
  const [updated] = await db().update(projects).set({ ...meta, updatedAt: new Date() }).where(eq(projects.address, address)).returning()
  return json(projectView(updated))
})
