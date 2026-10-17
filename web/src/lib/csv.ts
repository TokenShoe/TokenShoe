/**
 * Recipient-list CSV parsing (shared by Merkle airdrops and signature airdrops)
 *
 * Format: one `address,amount` per line; the first line may be a header (auto-detected).
 *   0xAbc...,100
 *   0xDef...,0.5
 * Amounts are in token units by default (e.g. 100 means 100 tokens) and are converted to wei using the token's decimals;
 * pass unit=wei to parse amounts as base units.
 *
 * All errors are collected per line and returned together (up to 50), so creators can fix everything in one go.
 */
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { isAddress, parseUnits } from 'viem'
import { ApiError, zAddress } from './http'
import { readTokenInfo } from './chain'

// Vercel rejects request bodies over 4.5MB, so keep uploads below that (≈100k rows of address,amount)
export const MAX_CSV_BYTES = 4 * 1024 * 1024
export const MAX_ROWS = 100_000

export interface CsvRow {
  line: number            // line number in the original file (1-based), for error messages
  account: `0x${string}`  // lowercase
  amount: bigint          // wei
}

export interface CsvLineError {
  line: number
  message: string
}

export type AmountUnit = 'token' | 'wei'

/** Convert a token-unit string to wei; returns an error message if the format is invalid */
export function parseAmount(raw: string, decimals: number, unit: AmountUnit): bigint | string {
  const s = raw.replace(/[_\s]/g, '')
  if (unit === 'wei') {
    if (!/^\d+$/.test(s)) return `Amount "${raw}" is not an integer (unit=wei expects base units)`
    return BigInt(s)
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return `Amount "${raw}" is not a valid number`
  const frac = s.split('.')[1]
  if (frac && frac.length > decimals) return `Amount "${raw}" has more decimals than the token supports (${decimals})`
  return parseUnits(s, decimals)
}

/** Read the uploaded file as text (with a size limit) */
export async function readCsvFile(file: File | null): Promise<string> {
  if (!file || typeof file === 'string') throw new ApiError(400, 'FILE_REQUIRED', 'Please upload a CSV file (form field "file")')
  if (file.size > MAX_CSV_BYTES) throw new ApiError(400, 'FILE_TOO_LARGE', 'CSV file must be 4MB or smaller (about 100,000 rows)')
  // Strip the BOM that Excel exports often include
  return (await file.text()).replace(/^﻿/, '')
}

/** Split CSV text into rows (tolerates blank lines, extra columns and surrounding whitespace) */
export function splitCsv(text: string): { line: number; cells: string[] }[] {
  let records: { record: string[]; info: { lines: number } }[]
  try {
    // info: true -> each record carries its line number in the original file
    records = parse(text, { skip_empty_lines: true, trim: true, relax_column_count: true, info: true })
  } catch (e) {
    throw new ApiError(400, 'CSV_INVALID', `Malformed CSV: ${e instanceof Error ? e.message : e}`)
  }
  return records.map(({ record, info }) => ({ line: info.lines, cells: record }))
}

/** Parse an "address,amount" list. Any error throws a 400 with the per-line error list */
export function parseAllocationCsv(text: string, decimals: number, unit: AmountUnit): CsvRow[] {
  const lines = splitCsv(text)
  // If the first cell of the first row is not an address, treat that row as a header and skip it
  const body = lines.length > 0 && !isAddress(lines[0].cells[0] ?? '', { strict: false }) ? lines.slice(1) : lines
  if (body.length === 0) throw new ApiError(400, 'CSV_EMPTY', 'CSV has no data rows')
  if (body.length > MAX_ROWS) throw new ApiError(400, 'CSV_TOO_MANY_ROWS', `At most ${MAX_ROWS} rows`)

  const rows: CsvRow[] = []
  const errors: CsvLineError[] = []
  const seen = new Map<string, number>()

  for (const { line, cells } of body) {
    const [addrRaw = '', amtRaw = ''] = cells
    if (!isAddress(addrRaw, { strict: false })) {
      errors.push({ line, message: `Invalid address "${addrRaw}"` })
      continue
    }
    const account = addrRaw.toLowerCase() as `0x${string}`
    const dup = seen.get(account)
    if (dup !== undefined) {
      errors.push({ line, message: `Duplicate address (same as line ${dup})` })
      continue
    }
    seen.set(account, line)
    const amount = parseAmount(amtRaw, decimals, unit)
    if (typeof amount === 'string') {
      errors.push({ line, message: amount })
      continue
    }
    if (amount === 0n) {
      errors.push({ line, message: 'Amount cannot be 0' })
      continue
    }
    rows.push({ line, account, amount })
  }

  if (errors.length > 0) {
    throw new ApiError(400, 'CSV_ROW_ERRORS', `CSV has ${errors.length} invalid row(s). Fix them and upload again`, errors.slice(0, 50))
  }
  return rows
}

export const zUnit = z.enum(['token', 'wei']).default('token')

/**
 * Determine token decimals from the upload form: prefer the decimals field, otherwise read decimals() on-chain via the token field
 */
export async function resolveDecimals(form: FormData): Promise<number> {
  const f = z.object({
    token: zAddress.optional(),
    decimals: z.coerce.number().int().min(0).max(36).optional(),
  }).parse({ token: form.get('token') ?? undefined, decimals: form.get('decimals') ?? undefined })
  if (f.decimals !== undefined) return f.decimals
  if (!f.token) throw new ApiError(400, 'TOKEN_REQUIRED', 'Provide either token (token address) or decimals')
  const info = await readTokenInfo(f.token)
  if (info.decimals === null) throw new ApiError(400, 'TOKEN_INVALID', 'Could not read token decimals. Check the token address')
  return info.decimals
}
