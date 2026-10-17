/** POST /api/auth/logout  Clear the session cookie */
import { json, route } from '@/lib/http'
import { SESSION_COOKIE } from '@/lib/auth'

export const POST = route('auth.logout', async () => {
  const res = json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
})
