/**
 * POST /api/vesting/parse  - convert a vesting schedule CSV into the initData the contract expects (no DB writes)
 *
 * multipart/form-data: file, token | decimals, unit?
 * The CSV must have a header row with these columns:
 *   beneficiary     beneficiary address
 *   amount          total amount (token units by default)
 *   tge_time        TGE time: unix seconds, ISO time with timezone (e.g. 2026-11-01T00:00:00Z), or YYYY-MM-DD (00:00 UTC)
 *   tge_percent     percentage unlocked at TGE, 0-100, at most 2 decimals
 *   cliff_days      cliff (days)
 *   vesting_days    linear vesting duration (days)
 *   interval_days   unlock interval (days), 0 = continuous per-second unlock
 *   revocable       whether it can be revoked: true/false/yes/no/1/0
 *
 * Returns: { schedules, totalAmount, initData }
 *   Create a project: createProject(2, token, >= totalAmount, salt, initData)
 *   Add schedules:    addSchedules(schedules) (fund enough tokens first)
 */
import { encodeAbiParameters, isAddress, parseAbiParameters } from 'viem'
import { ApiError, json, route } from '@/lib/http'
import { readCsvFile, splitCsv, parseAmount, resolveDecimals, zUnit, type CsvLineError } from '@/lib/csv'
import { VESTING_INIT_PARAMS } from '@/lib/abis'

export const dynamic = 'force-dynamic'

const COLUMNS = ['beneficiary', 'amount', 'tge_time', 'tge_percent', 'cliff_days', 'vesting_days', 'interval_days', 'revocable'] as const
const DAY = 86400
const MAX_SCHEDULES = 500 // too many in one tx would exceed the block gas limit

function parseTime(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(`${raw}T00:00:00Z`) / 1000
  // Require an explicit timezone to avoid ambiguity from the server's timezone
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}

function parseDays(raw: string): number | null {
  return /^\d+(\.\d+)?$/.test(raw) ? Math.round(Number(raw) * DAY) : null
}

export const POST = route('vesting.parse', async (req) => {
  const form = await req.formData()
  const unit = zUnit.parse(form.get('unit') ?? undefined)
  const decimals = await resolveDecimals(form)
  const lines = splitCsv(await readCsvFile(form.get('file') as File | null))
  if (lines.length < 2) throw new ApiError(400, 'CSV_EMPTY', 'CSV needs a header row and at least one data row')

  const header = lines[0].cells.map((c) => c.trim().toLowerCase())
  const missing = COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) throw new ApiError(400, 'CSV_MISSING_COLUMNS', `Missing columns: ${missing.join(', ')}`)
  if (lines.length - 1 > MAX_SCHEDULES) throw new ApiError(400, 'CSV_TOO_MANY_ROWS', `At most ${MAX_SCHEDULES} schedules per upload`)
  const col = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>

  const errors: CsvLineError[] = []
  const schedules = []
  for (const { line, cells } of lines.slice(1)) {
    const get = (c: (typeof COLUMNS)[number]) => (cells[col[c]] ?? '').trim()
    const err = (message: string) => errors.push({ line, message })

    const beneficiary = get('beneficiary')
    if (!isAddress(beneficiary, { strict: false })) { err(`Invalid address "${beneficiary}"`); continue }
    const amount = parseAmount(get('amount'), decimals, unit)
    if (typeof amount === 'string') { err(amount); continue }
    if (amount === 0n) { err('Amount cannot be 0'); continue }
    const tgeTime = parseTime(get('tge_time'))
    if (tgeTime === null) { err(`Unrecognized tge_time "${get('tge_time')}" (use unix seconds, YYYY-MM-DD, or ISO time with timezone)`); continue }
    const pct = get('tge_percent') || '0'
    if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) > 100) { err(`tge_percent "${pct}" must be 0–100 with at most 2 decimals`); continue }
    const cliff = parseDays(get('cliff_days') || '0')
    const vesting = parseDays(get('vesting_days') || '0')
    const interval = parseDays(get('interval_days') || '0')
    if (cliff === null || vesting === null || interval === null) { err('Day values must be non-negative numbers'); continue }
    if (interval > 0 && vesting > 0 && interval > vesting) { err('Unlock interval cannot be longer than the vesting duration'); continue }
    if (interval > 0xffffffff) { err('Unlock interval is too large'); continue }
    const rev = get('revocable').toLowerCase()
    if (!['true', 'false', 'yes', 'no', '1', '0', ''].includes(rev)) { err(`revocable "${rev}" must be true or false`); continue }

    schedules.push({
      beneficiary: beneficiary.toLowerCase() as `0x${string}`,
      totalAmount: amount,
      claimed: 0n,
      revokedClaimableCap: 0n,
      tgeTime: BigInt(tgeTime),
      tgeBps: Math.round(Number(pct) * 100),
      cliffDuration: BigInt(cliff),
      vestingDuration: BigInt(vesting),
      interval,
      revocable: ['true', 'yes', '1'].includes(rev),
      revoked: false,
    })
  }
  if (errors.length) throw new ApiError(400, 'CSV_ROW_ERRORS', `CSV has ${errors.length} invalid row(s)`, errors.slice(0, 50))

  const initData = encodeAbiParameters(parseAbiParameters(VESTING_INIT_PARAMS), [schedules])
  return json({
    schedules,
    totalAmount: schedules.reduce((s, x) => s + x.totalAmount, 0n).toString(),
    initData,
  })
})
