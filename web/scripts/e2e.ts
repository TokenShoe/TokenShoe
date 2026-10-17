/**
 * End-to-end test: runs the full flow of all three distribution types on a local anvil chain (real transactions + real API calls + DB result checks)
 *
 * Prerequisites:
 *   1. anvil                                    (local chain, port 8545 by default)
 *   2. Contracts + MockERC20 deployed on anvil (see "Local development" in the README)
 *   3. next dev started with environment variables pointing at anvil
 * Run:
 *   E2E_FACTORY=0x… E2E_TOKEN=0x… bun scripts/e2e.ts
 */
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, encodeAbiParameters,
  parseAbiParameters, keccak256, toHex, type Address, type Hex,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { foundry } from 'viem/chains'

const BASE = process.env.E2E_API ?? 'http://localhost:3000'
const RPC = process.env.E2E_RPC ?? 'http://127.0.0.1:8545'
const FACTORY = process.env.E2E_FACTORY as Address
const TOKEN = process.env.E2E_TOKEN as Address
if (!FACTORY || !TOKEN) throw new Error('Set E2E_FACTORY and E2E_TOKEN')

// Default anvil accounts
const creator = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const alice = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const bob = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')

const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const wallet = (account: typeof creator) => createWalletClient({ account, chain: foundry, transport: http(RPC) })

const ABI = parseAbi([
  'function createProject(uint8 implType, address token, uint256 fundAmount, bytes32 userSalt, bytes initData) returns (address)',
  'function predictAddress(uint8 implType, address creator, bytes32 userSalt) view returns (address)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function fund(uint256 amount)',
  'function pause()',
  'function unpause()',
  'function claim(uint256 index, address account, uint256 amount, bytes32[] proof)',
  'function claim(address account, uint256 amount, bytes32 claimId, uint256 deadline, bytes sig)',
  'function claim(uint256[] ids)',
  'function revoke(uint256 id)',
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0
function check(cond: unknown, msg: string, extra?: unknown) {
  if (!cond) {
    console.error(`  ✗ ${msg}`, extra !== undefined ? JSON.stringify(extra, null, 2) : '')
    process.exit(1)
  }
  passed++
  console.log(`  ✓ ${msg}`)
}

type Res = { status: number; body: any }
async function api(path: string, opts: { method?: string; json?: unknown; form?: FormData; cookie?: string } = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.json || opts.form ? 'POST' : 'GET'),
    headers: {
      ...(opts.json ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.json ? JSON.stringify(opts.json) : opts.form,
  })
  return { status: res.status, body: await res.json() }
}

async function login(account: typeof creator): Promise<string> {
  const { body: { nonce } } = await api('/api/auth/nonce')
  const message = createSiweMessage({
    address: account.address, chainId: foundry.id, domain: 'localhost:3000', nonce,
    uri: 'http://localhost:3000', version: '1', statement: 'Sign in to TokenShoe',
  })
  const signature = await account.signMessage({ message })
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }),
  })
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error(`Sign-in failed ${res.status} ${await res.text()}`)
  return cookie
}

function csvForm(csv: string, fields: Record<string, string> = {}) {
  const f = new FormData()
  f.set('file', new Blob([csv], { type: 'text/csv' }), 'list.csv')
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

async function send(account: typeof creator, address: Address, functionName: string, args: unknown[]): Promise<Hex> {
  const hash = await wallet(account).writeContract({ address, abi: ABI, functionName: functionName as any, args: args as any })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} reverted`)
  return hash
}

async function createProject(implType: number, amount: bigint, initData: Hex): Promise<{ address: Address; hash: Hex }> {
  const salt = keccak256(toHex(`e2e-${Date.now()}-${Math.random()}`))
  const address = await pub.readContract({ address: FACTORY, abi: ABI, functionName: 'predictAddress', args: [implType, creator.address, salt] })
  await send(creator, TOKEN, 'approve', [FACTORY, amount])
  const hash = await send(creator, FACTORY, 'createProject', [implType, TOKEN, amount, salt, initData])
  return { address: address.toLowerCase() as Address, hash }
}

const sync = (txHash: Hex, extra: Record<string, unknown> = {}) => api('/api/tx', { json: { txHash, ...extra } })
const now = () => Math.floor(Date.now() / 1000)

// ─── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  await send(creator, TOKEN, 'mint', [creator.address, parseEther('1000000')])
  const statsBefore = (await api('/api/stats')).body

  console.log('\n[Sign-in]')
  const unauth = await api('/api/merkle/trees', { form: csvForm('x') })
  check(unauth.status === 401, 'upload list without sign-in -> 401')
  const cookie = await login(creator)
  check((await api('/api/auth/me', { cookie })).body.address === creator.address.toLowerCase(), 'sign-in works, /api/auth/me returns the address')

  // ── Merkle ────────────────────────────────────────────────────────────────
  console.log('\n[Merkle airdrop]')
  const bad = await api('/api/merkle/trees', { cookie, form: csvForm(`address,amount\n0x123,1\n${alice.address},abc\n${bob.address},1\n${bob.address},2`, { token: TOKEN }) })
  check(bad.status === 400 && bad.body.error.details.length === 3, 'CSV errors reported per line (bad address, bad amount, duplicate)', bad.body)

  const csv = `address,amount\n${alice.address},100\n${bob.address},50.5\n${creator.address},1`
  const up = await api('/api/merkle/trees', { cookie, form: csvForm(csv, { token: TOKEN }) })
  check(up.status === 200 && up.body.totalEntries === 3 && up.body.totalAmount === parseEther('151.5').toString(), 'upload CSV builds the Merkle tree', up.body)

  const m = await createProject(0, parseEther('200'), encodeAbiParameters(
    parseAbiParameters('bytes32, uint64, uint64'), [up.body.root, BigInt(now() - 60), BigInt(now() + 86400)]))
  const ms = await sync(m.hash, { meta: { name: 'Merkle test', website: 'https://example.com' } })
  check(ms.status === 200 && ms.body.status === 'processed' && ms.body.projectsCreated[0] === m.address, 'sync creation tx', ms.body)
  check((await sync(m.hash)).body.status === 'already_processed', 'resubmitting the same tx -> already_processed')

  let p = (await api(`/api/projects/${m.address}`)).body
  check(p.name === 'Merkle test' && p.totalFunded === parseEther('200').toString() && p.stats.recipients === 3 && p.status === 'active',
    'project details: name / funded / recipients / status correct', p)

  const proof = (await api(`/api/projects/${m.address}/merkle-proof?account=${alice.address}`)).body
  check(proof.amount === parseEther('100').toString() && !proof.claimed, 'got alice\'s proof')
  check((await api(`/api/projects/${m.address}/merkle-proof?account=0x000000000000000000000000000000000000dead`)).status === 404, 'not on the list -> 404')

  const mc = await send(alice, m.address, 'claim', [BigInt(proof.index), alice.address, BigInt(proof.amount), proof.proof])
  check((await sync(mc)).body.events.some((e: any) => e.event === 'Claimed'), 'alice claims on-chain and syncs')
  check((await api(`/api/projects/${m.address}/merkle-proof?account=${alice.address}`)).body.claimed === true, 'alice is now marked as claimed')

  const pz = await send(creator, m.address, 'pause', [])
  await sync(pz)
  check((await api(`/api/projects/${m.address}`)).body.status === 'paused', 'status after pause = paused')
  await sync(await send(creator, m.address, 'unpause', []))
  p = (await api(`/api/projects/${m.address}`)).body
  check(p.status === 'active' && !p.paused, 'status after unpause = active')

  // ── Sign ──────────────────────────────────────────────────────────────────
  console.log('\n[Signature airdrop]')
  const signerKey = generatePrivateKey()
  const signerAddr = privateKeyToAccount(signerKey).address
  check((await api(`/api/sign/check-signer?address=${signerAddr}`)).body.fresh === true, 'fresh account check: fresh')
  check((await api(`/api/sign/check-signer?address=${creator.address}`)).body.fresh === false, 'funded account check: not fresh')

  const s = await createProject(1, parseEther('1000'), encodeAbiParameters(
    parseAbiParameters('address, uint64, uint64'), [signerAddr, BigInt(now() - 60), BigInt(now() + 86400)]))
  const ss = await sync(s.hash, { meta: { name: 'Signature test' }, signerPrivateKey: signerKey })
  check(ss.status === 200 && ss.body.warnings.length === 0, 'sync creation tx + signer key accepted', ss.body)
  check((await api(`/api/projects/${s.address}`)).body.signerReady === true, 'signerReady = true')

  const noAlloc = await api(`/api/projects/${s.address}/sign/request`, { json: { account: alice.address } })
  check(noAlloc.status === 403 && noAlloc.body.error.code === 'NOT_ELIGIBLE', 'request signature with empty list -> NOT_ELIGIBLE')

  const bobCookie = await login(bob)
  const forbidden = await api(`/api/projects/${s.address}/sign/allocations`, { cookie: bobCookie, form: csvForm(`${bob.address},999`) })
  check(forbidden.status === 403, 'non-creator edits list -> 403')

  const al = await api(`/api/projects/${s.address}/sign/allocations`, { cookie, form: csvForm(`${alice.address},10\n${bob.address},20`) })
  check(al.status === 200 && al.body.summary.count === 2, 'upload signature list (merge)', al.body)

  async function claimSign(who: typeof creator, report = true) {
    const r = await api(`/api/projects/${s.address}/sign/request`, { json: { account: who.address } })
    if (r.status !== 200) return { r }
    const hash = await send(who, s.address, 'claim', [who.address, BigInt(r.body.amount), r.body.claimId, BigInt(r.body.deadline), r.body.signature])
    if (report) await sync(hash)
    return { r, hash }
  }

  const c1 = await claimSign(alice)
  check(c1.r.body.amount === parseEther('10').toString(), 'alice claims 10 (1st time)')
  const put = await api(`/api/projects/${s.address}/sign/allocations`, { method: 'PUT', cookie, json: { account: alice.address, amount: '15' } })
  check(put.status === 200 && put.body.amount === parseEther('15').toString(), 'creator raises alice to 15 live')
  const c2 = await claimSign(alice)
  check(c2.r.body.amount === parseEther('5').toString(), 'alice claims the 5 difference (2nd time)')
  const c3 = await claimSign(alice)
  check(c3.r.status === 409 && c3.r.body.error.code === 'NOTHING_TO_CLAIM', 'alice requests again -> NOTHING_TO_CLAIM')

  const b1 = await claimSign(bob, false)  // on-chain but deliberately not synced
  const b2 = await api(`/api/projects/${s.address}/sign/request`, { json: { account: bob.address } })
  check(b2.status === 409 && b2.body.error.code === 'CLAIM_PENDING_SYNC', 'refuse to sign while previous claim is unsynced -> CLAIM_PENDING_SYNC')
  await sync(b1.hash!)

  const rep = await api(`/api/projects/${s.address}/sign/allocations`, { cookie, form: csvForm(`${bob.address},25`, { mode: 'replace' }) })
  check(rep.status === 200, 'replace mode upload (only bob 25)')
  const list = (await api(`/api/projects/${s.address}/sign/allocations`, { cookie })).body
  const a = list.items.find((x: any) => x.account === alice.address.toLowerCase())
  const b = list.items.find((x: any) => x.account === bob.address.toLowerCase())
  check(a.amount === a.claimed && b.amount === parseEther('25').toString() && b.claimed === parseEther('20').toString(),
    'after replace: alice locked at claimed, bob allocation 25 with 20 claimed', list.items)
  check((await claimSign(bob)).r.body.amount === parseEther('5').toString(), 'bob claims the extra 5')

  // ── Vesting ───────────────────────────────────────────────────────────────
  console.log('\n[Vesting]')
  const vcsv = [
    'beneficiary,amount,tge_time,tge_percent,cliff_days,vesting_days,interval_days,revocable',
    `${alice.address},1000,${now() - 100},10,0,30,0,false`,
    `${bob.address},500,${now() - 100},0,10,30,1,true`,
  ].join('\n')
  const vp = await api('/api/vesting/parse', { form: csvForm(vcsv, { token: TOKEN }) })
  check(vp.status === 200 && vp.body.totalAmount === parseEther('1500').toString(), 'vesting CSV -> initData', vp.body)

  const v = await createProject(2, parseEther('1500'), vp.body.initData)
  const vs = await sync(v.hash, { meta: { name: 'Vesting test' } })
  check(vs.body.events.filter((e: any) => e.event === 'ScheduleCreated').length === 2, 'sync creation tx, 2 schedules stored', vs.body)

  const el = (await api(`/api/projects/${v.address}/eligibility?account=${alice.address}`)).body
  check(el.eligible && BigInt(el.claimable) >= parseEther('100'), 'alice can claim >= 100 TGE', el)
  await sync(await send(alice, v.address, 'claim', [[0n]]))
  const el2 = (await api(`/api/projects/${v.address}/eligibility?account=${alice.address}`)).body
  check(BigInt(el2.claimed) >= parseEther('100'), 'claimed updated after alice claims', el2)

  await sync(await send(creator, v.address, 'revoke', [1n]))
  const elb = (await api(`/api/projects/${v.address}/eligibility?account=${bob.address}`)).body
  check(elb.schedules[0].revoked === true && elb.allocated === '0', 'bob\'s schedule revoked (revoked during cliff, allocation drops to 0)', elb)

  // ── Unsynced project ──────────────────────────────────────────────────────
  console.log('\n[Missed-sync protection]')
  const lost = await createProject(0, parseEther('1'), encodeAbiParameters(
    parseAbiParameters('bytes32, uint64, uint64'), [up.body.root, BigInt(now() + 3600), BigInt(now() + 7200)]))
  await send(creator, TOKEN, 'approve', [lost.address, parseEther('5')])
  const fundHash = await send(creator, lost.address, 'fund', [parseEther('5')])
  const f1 = await sync(fundHash)
  check(f1.status === 409 && f1.body.error.code === 'PROJECT_NOT_SYNCED', 'submit fund tx first -> PROJECT_NOT_SYNCED (no events lost)', f1.body)
  await sync(lost.hash)
  await sync(fundHash)
  check((await api(`/api/projects/${lost.address}`)).body.totalFunded === parseEther('6').toString(), 'after syncing creation then fund, totalFunded = 6')

  // ── Stats ─────────────────────────────────────────────────────────────────
  console.log('\n[Stats]')
  const st = (await api('/api/stats')).body
  check(st.totalProjects - statsBefore.totalProjects === 4, 'platform projects +4', st)
  check(st.totalClaims - statsBefore.totalClaims === 6, 'platform claims +6 (merkle 1 + sign 4 + vesting 1)', st)
  const daily = (await api('/api/stats/daily?days=7')).body.items
  check(daily.length === 7 && daily[6].claims >= 6, 'daily stats: 7 consecutive days, >= 6 claims today', daily.slice(-1))
  const ps = (await api(`/api/projects/${s.address}`)).body.stats
  check(ps.claimCount === 4 && ps.claimerCount === 2 && ps.recipients === 2, 'signature project stats: 4 claims / 2 claimers, 2 recipients', ps)
  const mine = (await api(`/api/accounts/${alice.address}/claimable`)).body.items
  check(mine.length >= 3, 'alice\'s claimable list includes all 3 types', mine.map((x: any) => x.project.type))
  const hist = (await api(`/api/accounts/${alice.address}/claims`)).body
  check(hist.total >= 4, 'alice claim history >= 4 entries')

  console.log(`\nAll passed: ${passed} checks ✅`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
