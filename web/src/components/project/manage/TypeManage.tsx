'use client'
/**
 * Type-specific management features
 *  - Merkle: replace the list before start (upload -> setRoot -> sync)
 *  - Signature: add / edit / remove recipients (effective immediately), provide or rotate the signer key
 *  - Vesting: revoke schedules, add schedules (fund -> addSchedules)
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Pencil, Trash2, Check, X, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Notice, RowErrors, Loading, EmptyState } from '@/components/ui/Feedback'
import { FileDrop } from '@/components/ui/FileDrop'
import { Table } from '@/components/ui/Data'
import { Pager, Tabs } from '@/components/ui/Tabs'
import { Section } from './Common'
import { AddressLink, Amount } from '../Bits'
import { SearchBox, fullAddress, VestingSchedulesTable } from '../Tables'
import { useChainTx } from '@/hooks/useChainTx'
import { useAuth } from '@/hooks/useAuth'
import { useSignAllocations } from '@/hooks/queries'
import { api, ApiClientError } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/errors'
import { formatDateTime, formatToken, shortAddr, toInputAmount } from '@/lib/client/format'
import { ERC20_FULL_ABI, MERKLE_WRITE_ABI, PROJECT_BASE_ABI, SIGN_WRITE_ABI, VESTING_WRITE_ABI } from '@/lib/abis'
import type { ProjectDTO } from '@/lib/client/types'

type RowError = { line: number; message: string }
const rowErrors = (e: unknown) => (e instanceof ApiClientError && e.code === 'CSV_ROW_ERRORS' ? (e.details as RowError[]) : null)

// ─── Merkle ──────────────────────────────────────────────────────────────────

export function MerkleManage({ p }: { p: ProjectDTO }) {
  const { ensureSignedIn } = useAuth()
  const { send } = useChainTx()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<RowError[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canChange = p.startTime !== null && Date.now() / 1000 < p.startTime

  async function replace() {
    if (!file) return
    setBusy(true); setErrors(null); setError(null)
    try {
      await ensureSignedIn()
      const form = new FormData()
      form.set('file', file)
      form.set('decimals', String(p.tokenDecimals))
      const tree = await api<{ root: `0x${string}`; totalEntries: number; totalAmount: string }>('/api/merkle/trees', { form })
      if (BigInt(tree.totalAmount) > BigInt(p.totalFunded)) {
        toast.warning('The new list total is more than the deposit. Top up so everyone can claim.')
      }
      await send({ label: 'Replace recipient list', request: { address: p.address, abi: MERKLE_WRITE_ABI, functionName: 'setRoot', args: [tree.root] } })
      setFile(null)
    } catch (e) {
      const rows = rowErrors(e)
      setErrors(rows); if (!rows && e instanceof ApiClientError) setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Replace recipient list"
      desc={canChange ? `You can replace the list until claiming opens (${formatDateTime(p.startTime!)}).` : 'The list is locked because claiming has started.'}>
      {canChange && (
        <>
          <FileDrop file={file} onFile={(f) => { setFile(f); setErrors(null) }} hint='"address,amount" per line' />
          {errors && <RowErrors errors={errors} />}
          {error && <Notice tone="error">{error}</Notice>}
          <Button onClick={replace} loading={busy} disabled={!file} size="sm">Upload & replace on-chain</Button>
        </>
      )}
    </Section>
  )
}

// ─── Signature ───────────────────────────────────────────────────────────────

export function SignManage({ p }: { p: ProjectDTO }) {
  return (
    <>
      <SignerPanel p={p} />
      <AllocationsPanel p={p} />
    </>
  )
}

function SignerPanel({ p }: { p: ProjectDTO }) {
  const { ensureSignedIn } = useAuth()
  const { send } = useChainTx()
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Provide the private key matching the on-chain signer */
  async function register(privateKey: string) {
    await ensureSignedIn()
    await api(`/api/projects/${p.address}/sign/signer`, { json: { privateKey } })
    toast.success('Signer key saved — recipients can claim now')
    setKey('')
    await qc.invalidateQueries()
  }

  async function submitExisting() {
    setBusy(true); setError(null)
    try { await register(key) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  /** Rotate to a new signer: generate a key -> setSigner on-chain -> sync -> upload the key */
  async function rotate() {
    setBusy(true); setError(null)
    try {
      await ensureSignedIn()
      const pk = generatePrivateKey()
      const addr = privateKeyToAccount(pk).address
      const fresh = await api<{ fresh: boolean; reason?: string }>(`/api/sign/check-signer?address=${addr}`)
      if (!fresh.fresh) throw new Error(fresh.reason ?? 'Generated key is not fresh, try again')
      await send({ label: 'Change signer', request: { address: p.address, abi: SIGN_WRITE_ABI, functionName: 'setSigner', args: [addr] } })
      await register(pk)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Signer key"
      desc="Every claim is signed by this project's dedicated key. Rotating it immediately invalidates all signatures that were already handed out.">
      <div className="text-sm flex items-center gap-2 flex-wrap">
        <span className="text-muted">On-chain signer</span>
        {p.signerAddress && <AddressLink address={p.signerAddress} />}
        {p.signerReady
          ? <span className="text-xs text-green-text">✓ key on server</span>
          : <span className="text-xs text-red-text">✗ key missing — recipients cannot claim</span>}
      </div>
      {!p.signerReady && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input label="Signer private key" type="password" autoComplete="off" placeholder="0x…" value={key} onChange={(e) => setKey(e.target.value.trim())} />
          </div>
          <Button onClick={submitExisting} loading={busy} disabled={!key}>Save key</Button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="secondary" size="sm" onClick={rotate} loading={busy}><KeyRound size={13} /> Rotate to a new signer</Button>
    </Section>
  )
}

function AllocationsPanel({ p }: { p: ProjectDTO }) {
  const { signedIn, ensureSignedIn, signingIn } = useAuth()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const q = useSignAllocations(p.address, page, fullAddress(search), signedIn)

  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<RowError[] | null>(null)
  const [newAcc, setNewAcc] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [editing, setEditing] = useState<{ account: string; value: string } | null>(null)

  const refresh = () => qc.invalidateQueries({ predicate: (x) => ['sign-allocations', 'project', 'claimable', 'eligibility'].includes(String(x.queryKey[0])) })

  async function upload() {
    if (!file) return
    setBusy(true); setErrors(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('mode', mode)
      const r = await api<{ rows: number }>(`/api/projects/${p.address}/sign/allocations`, { form })
      toast.success(`${r.rows} rows ${mode === 'replace' ? 'set as the new list' : 'merged'}`)
      setFile(null)
      await refresh()
    } catch (e) {
      const rows = rowErrors(e); setErrors(rows); if (!rows) toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function put(account: string, amount: string) {
    try {
      await api(`/api/projects/${p.address}/sign/allocations`, { method: 'PUT', json: { account, amount } })
      toast.success('Allocation saved')
      await refresh()
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    }
  }

  async function remove(account: string) {
    if (!confirm(`Remove ${shortAddr(account)} from the list? Anything already claimed stays claimed.`)) return
    try {
      await api(`/api/projects/${p.address}/sign/allocations?account=${account}`, { method: 'DELETE' })
      toast.success('Removed')
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (!signedIn) {
    return (
      <Section title="Recipient list" desc="Sign in with your wallet to view and edit the list. It is private to you.">
        <Button size="sm" onClick={() => ensureSignedIn().catch((e) => toast.error(errorMessage(e)))} loading={signingIn}>Sign in to manage</Button>
      </Section>
    )
  }

  const s = q.data?.summary
  const fmt = (v: string) => formatToken(v, p.tokenDecimals)
  return (
    <Section title="Recipient list"
      desc="Changes take effect immediately. An allocation is the total an address can claim; raising it lets someone who already claimed claim the difference.">
      {s && (
        <div className="text-sm text-muted">
          <b className="text-ink">{s.count.toLocaleString('en-US')}</b> recipients · <b className="text-ink">{fmt(s.totalAllocated)}</b> allocated ·{' '}
          <b className="text-ink">{fmt(s.totalClaimed)}</b> claimed · budget <b className="text-ink">{fmt(p.totalFunded)}</b> {p.tokenSymbol}
          {BigInt(s.totalAllocated) > BigInt(p.totalFunded) + BigInt(p.totalClaimed) && (
            <Notice tone="warning" className="mt-2">Allocations exceed the remaining budget. Top up or some claims will fail.</Notice>
          )}
        </div>
      )}

      <div className="rounded-btn border border-border p-4 space-y-3">
        <Tabs value={mode} onChange={setMode} tabs={[{ key: 'merge', label: 'Add / update from CSV' }, { key: 'replace', label: 'Replace whole list' }]} />
        <p className="text-xs text-muted">
          {mode === 'merge'
            ? 'Addresses in the file are added or updated. Everyone else stays as is.'
            : 'The list becomes exactly the file. Removed addresses keep what they already claimed but cannot claim more.'}
        </p>
        <FileDrop file={file} onFile={(f) => { setFile(f); setErrors(null) }} hint='"address,amount" per line' />
        {errors && <RowErrors errors={errors} />}
        <Button size="sm" onClick={upload} loading={busy} disabled={!file}>{mode === 'merge' ? 'Upload & merge' : 'Upload & replace'}</Button>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-[2]"><Input label="Add one address" placeholder="0x…" value={newAcc} onChange={(e) => setNewAcc(e.target.value.trim())} spellCheck={false} /></div>
        <div className="flex-1"><Input label={`Amount (${p.tokenSymbol ?? ''})`} inputMode="decimal" value={newAmt} onChange={(e) => setNewAmt(e.target.value)} /></div>
        <Button onClick={async () => { if (await put(newAcc, newAmt)) { setNewAcc(''); setNewAmt('') } }} disabled={!fullAddress(newAcc) || !newAmt}>Add</Button>
      </div>

      <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1) }} />
      {q.isLoading ? <Loading /> : q.data?.items.length ? (
        <>
          <Table head={['Recipient', 'Allocation', 'Claimed', '']}>
            {q.data.items.map((r) => (
              <tr key={r.account}>
                <td className="py-2 pr-4"><AddressLink address={r.account} /></td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {editing?.account === r.account ? (
                    <input autoFocus className="w-28 px-2 py-1 border border-ink rounded-btn text-sm" value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })} inputMode="decimal" />
                  ) : <Amount wei={r.amount} decimals={p.tokenDecimals} />}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-muted"><Amount wei={r.claimed} decimals={p.tokenDecimals} /></td>
                <td className="py-2 text-right whitespace-nowrap">
                  {editing?.account === r.account ? (
                    <>
                      <button className="p-1.5 rounded-btn hover:bg-black/5" aria-label="Save" onClick={async () => { if (await put(r.account, editing.value)) setEditing(null) }}><Check size={14} /></button>
                      <button className="p-1.5 rounded-btn hover:bg-black/5" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button className="p-1.5 rounded-btn hover:bg-black/5 text-muted" aria-label="Edit" onClick={() => setEditing({ account: r.account, value: toInputAmount(r.amount, p.tokenDecimals) })}><Pencil size={13} /></button>
                      <button className="p-1.5 rounded-btn hover:bg-black/5 text-muted" aria-label="Remove" onClick={() => remove(r.account)}><Trash2 size={13} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={20} total={q.data.total} onChange={setPage} />
        </>
      ) : <EmptyState title={search ? 'No matching recipient' : 'No recipients yet'}>Upload a CSV or add addresses above.</EmptyState>}
    </Section>
  )
}

// ─── Vesting ─────────────────────────────────────────────────────────────────

interface ParsedSchedule {
  beneficiary: `0x${string}`; totalAmount: string; claimed: string; revokedClaimableCap: string; tgeTime: string
  tgeBps: number; cliffDuration: string; vestingDuration: string; interval: number; revocable: boolean; revoked: boolean
}

export function VestingManage({ p }: { p: ProjectDTO }) {
  const { send } = useChainTx()
  const [revoking, setRevoking] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<RowError[] | null>(null)

  async function revoke(id: number) {
    if (!confirm(`Revoke schedule #${id}? Already-unlocked tokens stay claimable by the beneficiary; the rest returns to you.`)) return
    setRevoking(id)
    try {
      await send({ label: `Revoke schedule #${id}`, request: { address: p.address, abi: VESTING_WRITE_ABI, functionName: 'revoke', args: [BigInt(id)] } })
    } catch { /* already shown as a toast */ } finally {
      setRevoking(null)
    }
  }

  /** Add schedules: parse the CSV -> fund the same amount -> addSchedules */
  async function addSchedules() {
    if (!file) return
    setBusy(true); setErrors(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('decimals', String(p.tokenDecimals))
      const r = await api<{ schedules: ParsedSchedule[]; totalAmount: string }>('/api/vesting/parse', { form })
      const total = BigInt(r.totalAmount)
      await send({ label: `Approve ${p.tokenSymbol}`, request: { address: p.tokenAddress, abi: ERC20_FULL_ABI, functionName: 'approve', args: [p.address, total] }, sync: false })
      await send({ label: 'Fund schedules', request: { address: p.address, abi: PROJECT_BASE_ABI, functionName: 'fund', args: [total] } })
      const list = r.schedules.map((x) => ({
        ...x, totalAmount: BigInt(x.totalAmount), claimed: 0n, revokedClaimableCap: 0n, tgeTime: BigInt(x.tgeTime),
        cliffDuration: BigInt(x.cliffDuration), vestingDuration: BigInt(x.vestingDuration),
      }))
      await send({ label: `Add ${list.length} schedule(s)`, request: { address: p.address, abi: VESTING_WRITE_ABI, functionName: 'addSchedules', args: [list] } })
      setFile(null)
    } catch (e) {
      const rows = rowErrors(e); setErrors(rows); if (!rows && e instanceof ApiClientError) toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title="Schedules" desc="Revoking stops future unlocks. Tokens that already unlocked remain claimable by the beneficiary.">
        <VestingSchedulesTable p={p} action={(s) => s.revocable && !s.revoked ? (
          <Button variant="ghost" size="sm" loading={revoking === s.scheduleId} onClick={() => revoke(s.scheduleId)}>Revoke</Button>
        ) : null} />
      </Section>
      <Section title="Add schedules" desc="Upload a vesting CSV. You'll approve and deposit exactly the total, then add the schedules (3 transactions).">
        <FileDrop file={file} onFile={(f) => { setFile(f); setErrors(null) }}
          hint="beneficiary, amount, tge_time, tge_percent, cliff_days, vesting_days, interval_days, revocable" />
        {errors && <RowErrors errors={errors} />}
        <Button size="sm" onClick={addSchedules} loading={busy} disabled={!file}>Deposit & add schedules</Button>
      </Section>
    </>
  )
}

