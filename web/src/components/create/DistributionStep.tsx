'use client'
/**
 * Wizard step 3: list / schedules + claim window + deposit amount
 *  - Merkle: upload a CSV -> the backend builds the Merkle tree (sign-in required)
 *  - Signature: generate or import a brand-new signer key; the list can be picked now and uploaded after deploy, or uploaded later
 *  - Vesting: upload a CSV or enter manually -> the backend validates and encodes it as initData
 */
import { useState } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Download, KeyRound, Plus, Trash2 } from 'lucide-react'
import { CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Notice, RowErrors } from '@/components/ui/Feedback'
import { FileDrop, CsvTemplateLink } from '@/components/ui/FileDrop'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/hooks/useAuth'
import { api, ApiClientError } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/errors'
import { formatToken, localInputToUnix, parseTokenInput, shortAddr, toInputAmount, unixToLocalInput } from '@/lib/client/format'
import type { MerkleBuild, Patch, RowError, TokenInfo, VestingBuild, VestingRow, WizardState } from './types'

const AIRDROP_TEMPLATE = 'address,amount\n0x1111111111111111111111111111111111111111,100\n0x2222222222222222222222222222222222222222,25.5\n'
const VESTING_TEMPLATE =
  'beneficiary,amount,tge_time,tge_percent,cliff_days,vesting_days,interval_days,revocable\n' +
  '0x1111111111111111111111111111111111111111,100000,2026-12-01,10,90,360,30,false\n'

/** Default TGE: tomorrow at the next full hour (a prefilled value also avoids the browser's localized empty placeholder) */
function defaultTgeInput(): string {
  const d = new Date(Date.now() + 86400_000)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return unixToLocalInput(Math.floor(d.getTime() / 1000))
}

/** A new schedule row; pass the previous row's TGE so schedules added together share it */
export const emptyVestingRow = (tgeTime?: string): VestingRow => ({
  beneficiary: '', amount: '', tgeTime: tgeTime || defaultTgeInput(), tgePercent: '10', cliffDays: '90', vestingDays: '360', intervalDays: '30', revocable: false,
})

function rowErrors(e: unknown): RowError[] | null {
  return e instanceof ApiClientError && e.code === 'CSV_ROW_ERRORS' ? (e.details as RowError[]) : null
}

export function DistributionStep({ s, patch, token }: { s: WizardState; patch: Patch; token: TokenInfo }) {
  return (
    <>
      <CardHeader>
        <h2 className="font-display font-semibold text-ink">
          {s.type === 'merkle' ? 'Recipients & claim window' : s.type === 'sign' ? 'Signer, recipients & claim window' : 'Vesting schedules'}
        </h2>
      </CardHeader>
      <CardBody className="space-y-6">
        {s.type === 'merkle' && <MerkleSetup s={s} patch={patch} token={token} />}
        {s.type === 'sign' && <SignSetup s={s} patch={patch} />}
        {s.type === 'vesting' && <VestingSetup s={s} patch={patch} token={token} />}
        {s.type !== 'vesting' && <TimeWindow s={s} patch={patch} />}
        <FundAmount s={s} patch={patch} token={token} />
      </CardBody>
    </>
  )
}

// ─── Merkle ──────────────────────────────────────────────────────────────────

function MerkleSetup({ s, patch, token }: { s: WizardState; patch: Patch; token: TokenInfo }) {
  const { ensureSignedIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<RowError[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function build() {
    if (!s.merkleFile) return
    setBusy(true); setErrors(null); setError(null)
    try {
      await ensureSignedIn()
      const form = new FormData()
      form.set('file', s.merkleFile)
      form.set('decimals', String(token.decimals))
      const r = await api<MerkleBuild>('/api/merkle/trees', { form })
      patch({ merkle: r, fundAmount: toInputAmount(r.totalAmount, token.decimals) })
    } catch (e) {
      setErrors(rowErrors(e)); if (!rowErrors(e)) setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink">Recipient list (CSV)</label>
        <CsvTemplateLink name="airdrop-template.csv" content={AIRDROP_TEMPLATE} />
      </div>
      <FileDrop file={s.merkleFile} onFile={(f) => { patch({ merkleFile: f, merkle: null }); setErrors(null) }}
        hint={`One "address,amount" per line. Amounts in ${token.symbol} (decimals allowed).`} />
      {s.merkleFile && !s.merkle && (
        <Button onClick={build} loading={busy} className="w-full">Build Merkle tree</Button>
      )}
      <p className="text-xs text-muted">You will be asked to sign a message to verify you own this wallet (free, no transaction).</p>
      {errors && <RowErrors errors={errors} />}
      {error && <Notice tone="error">{error}</Notice>}
      {s.merkle && (
        <Notice tone="success" title={`${s.merkle.totalEntries.toLocaleString('en-US')} recipients · ${formatToken(s.merkle.totalAmount, token.decimals)} ${token.symbol}`}>
          <div className="font-mono-data break-all">root {s.merkle.root}</div>
        </Notice>
      )}
    </div>
  )
}

// ─── Signature ───────────────────────────────────────────────────────────────

function SignSetup({ s, patch }: { s: WizardState; patch: Patch }) {
  const [mode, setMode] = useState<'generate' | 'import'>('generate')
  const [importValue, setImportValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  async function applyKey(key: string) {
    let addr: string
    try {
      addr = privateKeyToAccount(key as `0x${string}`).address
    } catch {
      setReason('Invalid private key'); patch({ signerKey: '', signerAddress: '', signerFresh: null })
      return
    }
    patch({ signerKey: key, signerAddress: addr, signerFresh: null, signerBackedUp: false })
    setChecking(true); setReason(null)
    try {
      const r = await api<{ fresh: boolean; reason?: string }>(`/api/sign/check-signer?address=${addr}`)
      patch({ signerFresh: r.fresh }); setReason(r.reason ?? null)
    } catch (e) {
      setReason(errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  function downloadBackup() {
    const text = `TokenShoe signer key\nAddress: ${s.signerAddress}\nPrivate key: ${s.signerKey}\n\nThis key can only sign claims for your project. Keep it private.\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `tokendis-signer-${s.signerAddress.slice(2, 8)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
    patch({ signerBackedUp: true })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="text-sm font-medium text-ink">Signer key</div>
        <p className="text-xs text-muted leading-relaxed">
          Our backend signs each claim with a dedicated key that belongs only to this project. It must be a <b>brand-new, empty account</b> —
          never one that holds funds. The key is encrypted on our server and never used to send transactions.
        </p>
        <Tabs value={mode} onChange={(m) => { setMode(m); setReason(null) }}
          tabs={[{ key: 'generate', label: 'Generate new key' }, { key: 'import', label: 'Use my own key' }]} />
        {mode === 'generate' ? (
          <Button variant="secondary" onClick={() => applyKey(generatePrivateKey())}>
            <KeyRound size={14} /> {s.signerKey ? 'Generate another' : 'Generate signer key'}
          </Button>
        ) : (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input label="Private key" type="password" placeholder="0x… (64 hex characters)" value={importValue}
                onChange={(e) => setImportValue(e.target.value.trim())} autoComplete="off" spellCheck={false} />
            </div>
            <Button variant="secondary" onClick={() => applyKey(importValue.startsWith('0x') ? importValue : `0x${importValue}`)}>Use key</Button>
          </div>
        )}
        {s.signerAddress && (
          <div className="rounded-btn border border-border p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Signer address</span>
              <span className="font-mono-data text-xs">{shortAddr(s.signerAddress, 10, 8)}</span>
            </div>
            {checking ? <p className="text-xs text-muted">Checking account…</p>
              : s.signerFresh ? <Notice tone="success">Brand-new empty account — good to go.</Notice>
              : reason ? <Notice tone="error">{reason}</Notice> : null}
            {mode === 'generate' && s.signerFresh && (
              <Button variant="ghost" size="sm" onClick={downloadBackup}>
                <Download size={13} /> {s.signerBackedUp ? 'Backup downloaded' : 'Download backup (optional)'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-ink">Recipient list (optional now)</label>
          <CsvTemplateLink name="airdrop-template.csv" content={AIRDROP_TEMPLATE} />
        </div>
        <FileDrop file={s.signFile} onFile={(f) => patch({ signFile: f })}
          hint="Uploaded right after deployment. You can add, edit or remove recipients any time later." />
      </div>
    </div>
  )
}

// ─── Vesting ─────────────────────────────────────────────────────────────────

function VestingSetup({ s, patch, token }: { s: WizardState; patch: Patch; token: TokenInfo }) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<RowError[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Manually entered rows -> CSV (reuses the same backend validation) */
  function rowsToCsv(rows: VestingRow[]) {
    const head = 'beneficiary,amount,tge_time,tge_percent,cliff_days,vesting_days,interval_days,revocable'
    return [head, ...rows.map((r) => [
      r.beneficiary, r.amount, r.tgeTime ? String(localInputToUnix(r.tgeTime)) : '', r.tgePercent || '0',
      r.cliffDays || '0', r.vestingDays || '0', r.intervalDays || '0', String(r.revocable),
    ].join(','))].join('\n')
  }

  async function build() {
    setBusy(true); setErrors(null); setError(null)
    try {
      const form = new FormData()
      if (s.vestingMode === 'csv') {
        if (!s.vestingFile) return
        form.set('file', s.vestingFile)
      } else {
        form.set('file', new Blob([rowsToCsv(s.vestingRows)], { type: 'text/csv' }), 'schedules.csv')
      }
      form.set('decimals', String(token.decimals))
      const r = await api<{ totalAmount: string; initData: `0x${string}`; schedules: unknown[] }>('/api/vesting/parse', { form })
      const build: VestingBuild = { totalAmount: r.totalAmount, initData: r.initData, count: r.schedules.length }
      patch({ vesting: build, fundAmount: toInputAmount(r.totalAmount, token.decimals) })
    } catch (e) {
      setErrors(rowErrors(e)); if (!rowErrors(e)) setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const setRow = (i: number, p: Partial<VestingRow>) => {
    const rows = [...s.vestingRows]; rows[i] = { ...rows[i], ...p }
    patch({ vestingRows: rows, vesting: null })
  }

  return (
    <div className="space-y-4">
      <Tabs value={s.vestingMode} onChange={(m) => patch({ vestingMode: m, vesting: null })}
        tabs={[{ key: 'manual', label: 'Enter manually' }, { key: 'csv', label: 'Upload CSV' }]} />

      {s.vestingMode === 'csv' ? (
        <div className="space-y-2">
          <div className="flex justify-end"><CsvTemplateLink name="vesting-template.csv" content={VESTING_TEMPLATE} /></div>
          <FileDrop file={s.vestingFile} onFile={(f) => patch({ vestingFile: f, vesting: null })}
            hint="Columns: beneficiary, amount, tge_time (YYYY-MM-DD UTC or unix), tge_percent, cliff_days, vesting_days, interval_days, revocable" />
        </div>
      ) : (
        <div className="space-y-3">
          {s.vestingRows.map((r, i) => (
            <div key={i} className="border border-border rounded-btn p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted uppercase tracking-wide">Schedule {i + 1}</span>
                {s.vestingRows.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => patch({ vestingRows: s.vestingRows.filter((_, j) => j !== i), vesting: null })}>
                    <Trash2 size={12} /> Remove
                  </Button>
                )}
              </div>
              <Input label="Beneficiary" placeholder="0x…" value={r.beneficiary} onChange={(e) => setRow(i, { beneficiary: e.target.value.trim() })} spellCheck={false} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={`Amount (${token.symbol})`} inputMode="decimal" placeholder="100000" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                <Input label="Unlocked at TGE (%)" inputMode="decimal" placeholder="10" value={r.tgePercent} onChange={(e) => setRow(i, { tgePercent: e.target.value })} />
              </div>
              <Input label="TGE date" type="datetime-local" value={r.tgeTime} onChange={(e) => setRow(i, { tgeTime: e.target.value })} hint="Your local time zone" />
              <div className="grid grid-cols-3 gap-3">
                <Input label="Cliff (days)" inputMode="numeric" value={r.cliffDays} onChange={(e) => setRow(i, { cliffDays: e.target.value })} />
                <Input label="Vesting (days)" inputMode="numeric" value={r.vestingDays} onChange={(e) => setRow(i, { vestingDays: e.target.value })} />
                <Input label="Every (days)" inputMode="numeric" value={r.intervalDays} onChange={(e) => setRow(i, { intervalDays: e.target.value })} hint="0 = continuous" />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={r.revocable} onChange={(e) => setRow(i, { revocable: e.target.checked })} />
                Revocable — you can stop future unlocks; already-unlocked tokens stay claimable
              </label>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => patch({ vestingRows: [...s.vestingRows, emptyVestingRow(s.vestingRows.at(-1)?.tgeTime)], vesting: null })}>
            <Plus size={13} /> Add schedule
          </Button>
        </div>
      )}

      {!s.vesting && (
        <Button onClick={build} loading={busy} className="w-full" disabled={s.vestingMode === 'csv' && !s.vestingFile}>
          Validate schedules
        </Button>
      )}
      {errors && <RowErrors errors={errors} />}
      {error && <Notice tone="error">{error}</Notice>}
      {s.vesting && (
        <Notice tone="success" title={`${s.vesting.count} schedule(s) · ${formatToken(s.vesting.totalAmount, token.decimals)} ${token.symbol}`}>
          Schedules are valid. Edit anything above to re-validate.
        </Notice>
      )}
    </div>
  )
}

// ─── Claim window & deposit ──────────────────────────────────────────────────

function TimeWindow({ s, patch }: { s: WizardState; patch: Patch }) {
  const bad = s.start && s.end && localInputToUnix(s.end) <= localInputToUnix(s.start)
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Claim opens" type="datetime-local" value={s.start} onChange={(e) => patch({ start: e.target.value })} />
        <Input label="Claim closes" type="datetime-local" value={s.end} onChange={(e) => patch({ end: e.target.value })}
          error={bad ? 'Must be after the opening time' : undefined} />
      </div>
      <p className="text-xs text-muted">
        Local time zone. You can only withdraw unclaimed tokens after the window closes. Pausing extends the window by the paused time.
      </p>
    </div>
  )
}

function FundAmount({ s, patch, token }: { s: WizardState; patch: Patch; token: TokenInfo }) {
  const required = s.type === 'merkle' ? s.merkle?.totalAmount : s.type === 'vesting' ? s.vesting?.totalAmount : undefined
  const amount = parseTokenInput(s.fundAmount, token.decimals)
  const tooLow = required !== undefined && amount !== null && amount < BigInt(required)
  const tooHigh = amount !== null && amount > token.balance
  return (
    <Input
      label={`Deposit amount (${token.symbol})`}
      inputMode="decimal"
      placeholder="0"
      value={s.fundAmount}
      onChange={(e) => patch({ fundAmount: e.target.value })}
      hint={
        s.type === 'sign'
          ? 'Total budget for this airdrop. You can top it up later.'
          : required ? `At least ${formatToken(required, token.decimals)} ${token.symbol} to cover every recipient.` : undefined
      }
      error={
        s.fundAmount && amount === null ? 'Not a valid amount'
          : tooLow ? (s.type === 'vesting' ? 'Must cover all schedules' : 'Less than the list total — some recipients would not be able to claim')
          : tooHigh ? `You only have ${formatToken(token.balance, token.decimals)} ${token.symbol}` : undefined
      }
    />
  )
}
