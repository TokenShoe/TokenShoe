/**
 * Shared helpers for API routes:
 *  - ApiError: business error with an HTTP status and a machine-readable code the frontend can switch on
 *  - route(): wrapper that catches errors uniformly, logs timing and returns JSON
 *  - parseBody / parseQuery: validate parameters with zod
 */
import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError, type ZodTypeAny } from 'zod'
import { log } from './logger'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

/** JSON serialization that turns bigint into string */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(
    JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    { ...init, headers: { 'content-type': 'application/json', ...init?.headers } },
  )
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>

/** Wrap a route handler: uniform error shape { error: { code, message, details } } + access log */
export function route<C = unknown>(name: string, fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const started = Date.now()
    try {
      const res = await fn(req, ctx)
      log.info('api', { route: name, method: req.method, status: res.status, ms: Date.now() - started })
      return res
    } catch (e) {
      const ms = Date.now() - started
      if (e instanceof ApiError) {
        log.warn('api', { route: name, method: req.method, status: e.status, code: e.code, msg: e.message, ms })
        return json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status })
      }
      if (e instanceof ZodError) {
        log.warn('api', { route: name, method: req.method, status: 400, code: 'BAD_REQUEST', ms })
        return json(
          { error: { code: 'BAD_REQUEST', message: 'Invalid parameters', details: e.issues } },
          { status: 400 },
        )
      }
      log.error('api', {
        route: name, method: req.method, status: 500, ms,
        msg: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      })
      return json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 })
    }
  }
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Request body is not valid JSON')
  }
  return schema.parse(body)
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams))
}

// ─── Common zod fields ───────────────────────────────────────────────────────

/** Address: validate the format and lowercase it */
export const zAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid address')
  .transform((s) => s.toLowerCase() as `0x${string}`)

export const zTxHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash')
  .transform((s) => s.toLowerCase() as `0x${string}`)

/** Pagination: page starts at 1, pageSize at most 100 */
export const zPage = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}

/** Project display info (submitted on creation / changed later via PATCH) */
export const zProjectMeta = z.object({
  name: z.string().trim().max(120).optional(),
  description: z.string().max(5000).optional(),
  logoUrl: z.string().url().max(300).optional(),
  website: z.string().url().max(200).optional(),
  twitter: z.string().max(80).optional(),
  telegram: z.string().max(80).optional(),
})
