/**
 * Browser-side wrapper for calling the backend API.
 * Backend errors are always { error: { code, message, details } }; they are rethrown as ApiClientError
 * so pages can branch on the code (e.g. CLAIM_PENDING_SYNC).
 * Every request carries the selected network (x-network header + ?network= in the URL, so browser/CDN caches never
 * mix networks); the backend uses that network's database and chain.
 */
import type { NetworkKey } from '@/config/networks'
import { getActiveNetwork } from './activeNetwork'

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  json?: unknown
  form?: FormData
  /** Backend network to talk to; defaults to the one selected in the nav */
  network?: NetworkKey
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const network = opts.network ?? getActiveNetwork()
  const url = `${path}${path.includes('?') ? '&' : '?'}network=${network}`
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? 'POST' : 'GET'),
      headers: {
        'x-network': network,
        ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.form,
      credentials: 'same-origin',
    })
  } catch (e) {
    throw new ApiClientError(0, 'NETWORK', 'Network error, please check your connection')
  }
  const text = await res.text()
  const body = text ? safeJson(text) : null
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiClientError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? `Request failed (${res.status})`, err?.details)
  }
  return body as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Common shape of list endpoints */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
