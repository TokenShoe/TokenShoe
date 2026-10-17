/**
 * Browser end-to-end test: clicks through the real pages in Chrome for "create -> claim -> manage".
 *
 * Prerequisites: same as scripts/e2e.ts (anvil + contracts + MockERC20), with next dev started in mock-wallet mode:
 *   NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_PUBLIC_MOCK_WALLET=1 NEXT_PUBLIC_FACTORY_ADDRESS=0x… …
 * Run:
 *   bun scripts/ui-e2e.ts            screenshots go to E2E_SHOTS (default ./e2e-shots)
 * The test mints its own token through the Test tokens page (needs NEXT_PUBLIC_TEST_TOKEN_FACTORY).
 * Alternatively set E2E_TOKEN=0x... to use an existing token the creator (anvil account 0) holds.
 */
import puppeteer, { type Page, type BrowserContext, type ElementHandle } from 'puppeteer-core'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BASE = process.env.E2E_API ?? 'http://localhost:3000'
let TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = resolve(process.env.E2E_SHOTS ?? 'e2e-shots')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(SHOTS, { recursive: true })

const CREATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const BOB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0
const ok = (msg: string) => { passed++; console.log(`  ✓ ${msg}`) }

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
}

async function newUser(browser: Awaited<ReturnType<typeof puppeteer.launch>>, account: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.evaluateOnNewDocument((a) => localStorage.setItem('mockAccount', a), account)
  page.on('pageerror', (e) => console.log(`    [pageerror] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/WalletConnect|favicon|Lit is in dev/i.test(m.text())) console.log(`    [console] ${m.text().slice(0, 200)}`) })
  return { ctx, page }
}

async function waitText(page: Page, text: string, timeout = 60_000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
}

async function clickText(page: Page, text: string, exact = false) {
  // Default: the button text starts with text (buttons may also contain icons); exact: equal
  const cond = exact ? `normalize-space()='${text}'` : `starts-with(normalize-space(), '${text}')`
  const el = await page.waitForSelector(`xpath/.//button[${cond}]`, { visible: true, timeout: 30_000 })
  await page.waitForFunction((e) => !(e as HTMLButtonElement).disabled, { timeout: 30_000 }, el)
  // Trigger a DOM click directly, so a button moving during an animation can't make the mouse miss
  await el!.evaluate((e) => (e as HTMLElement).click())
}

/** Set the value of a React controlled input (assign value + dispatch an input event) */
async function setValue(el: ElementHandle<Element>, value: string) {
  await el.evaluate((node, v) => {
    const input = node as HTMLInputElement
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Find an input by its label text (waits for it to appear: steps animate in) */
async function byLabel(page: Page, label: string, nth = 0) {
  const xp = `xpath/(.//label[normalize-space()='${label}']/following-sibling::*[self::input or self::textarea])[${nth + 1}]`
  const el = await page.waitForSelector(xp, { visible: true, timeout: 20_000 }).catch(() => null)
  if (!el) throw new Error(`Input not found: ${label}`)
  return el
}

const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

function csvFile(name: string, content: string) {
  const p = join(SHOTS, name)
  writeFileSync(p, content)
  return p
}

async function next(page: Page) {
  await clickText(page, 'Next')
}

/** Run the shared part of the create wizard (type + token), stopping at step 3 */
async function startWizard(page: Page, typeLabel: string) {
  await page.goto(`${BASE}/create`, { waitUntil: 'networkidle0' })
  await waitText(page, 'Choose a distribution type')
  await clickText(page, typeLabel)
  await next(page)
  await setValue(await byLabel(page, 'Token contract address'), TOKEN)
  await waitText(page, 'Your balance')
  await next(page)
}

async function finishWizard(page: Page, name: string, shotName: string): Promise<string> {
  await next(page)
  await setValue(await byLabel(page, 'Project name'), name)
  await next(page)
  await waitText(page, 'Review & deploy')
  await shot(page, `${shotName}-review`)
  await clickText(page, 'Deploy')
  await waitText(page, `${name} is live`, 90_000)
  const addr = await page.$eval('p.font-mono-data', (e) => e.textContent!.trim())
  await shot(page, `${shotName}-live`)
  return addr
}

async function setWindow(page: Page) {
  const inputs = await page.$$('input[type=datetime-local]')
  await setValue(inputs[0], localInput(new Date(Date.now() - 3600_000)))
  await setValue(inputs[1], localInput(new Date(Date.now() + 7 * 86400_000)))
}

async function claimFromClaimPage(page: Page, projectName: string) {
  await page.goto(`${BASE}/claim`, { waitUntil: 'networkidle0' })
  await waitText(page, projectName)
  // Find the Claim button inside this project's card
  const btn = await page.waitForSelector(
    `xpath/.//a[normalize-space()='${projectName}']/ancestor::div[contains(@class,'rounded-card')][1]//button[starts-with(normalize-space(),'Claim')]`,
    { timeout: 30_000 },
  )
  await btn!.evaluate((e) => (e as HTMLElement).click())
  // Success toast (shown by useChainTx once syncing completes)
  await waitText(page, 'Claim TT: done', 90_000)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [
    '--no-sandbox',
    // Both users' pages are open at once; background pages get animation frames throttled, which stalls step transitions
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  ] })
  const creator = await newUser(browser, CREATOR)
  const alice = await newUser(browser, ALICE)
  const tag = Date.now().toString(36).slice(-4)

  try {
    console.log('\n[Home]')
    await creator.page.goto(BASE, { waitUntil: 'networkidle0' })
    await waitText(creator.page, 'Platform activity')
    await waitText(creator.page, '0xf39F')   // mock wallet auto-connected (ConnectKit button shows the address)
    await shot(creator.page, '01-home')
    ok('home page loads, wallet connected')

    console.log('\n[Test token]')
    await creator.page.goto(`${BASE}/test-token`, { waitUntil: 'networkidle0' })
    await waitText(creator.page, 'Create a test token')
    await setValue(await byLabel(creator.page, 'Token name'), `UI Test Token ${tag}`)
    await setValue(await byLabel(creator.page, 'Symbol'), 'TT')
    await clickText(creator.page, 'Create & mint')
    await waitText(creator.page, '● New', 90_000)
    await waitText(creator.page, '100,000,000')
    await shot(creator.page, '01b-test-token')
    const newToken = await creator.page.$eval(
      'xpath/.//span[contains(text(),"● New")]/ancestor::div[contains(@class,"rounded-card")][1]//a[contains(@href,"/create?token=")]',
      (a) => new URL((a as HTMLAnchorElement).href).searchParams.get('token')!,
    )
    if (!TOKEN) TOKEN = newToken
    ok(`test token created with 100,000,000 in wallet ${newToken}`)
    // "Distribute" is a link styled as a button
    const distribute = await creator.page.waitForSelector(`a[href="/create?token=${newToken}"]`)
    await distribute!.evaluate((e) => (e as HTMLElement).click())
    await waitText(creator.page, 'Choose a distribution type')
    await clickText(creator.page, 'Next')
    await waitText(creator.page, 'Your balance')
    const prefilled = await (await byLabel(creator.page, 'Token contract address')).evaluate((e) => (e as HTMLInputElement).value)
    if (prefilled.toLowerCase() !== newToken.toLowerCase()) throw new Error(`wizard not prefilled: ${prefilled}`)
    ok('"Distribute" opens the wizard with the token prefilled')

    // Inline creation inside the wizard
    await setValue(await byLabel(creator.page, 'Token contract address'), '')
    await clickText(creator.page, 'Don')   // "Don't have a token yet?" (apostrophe can't go in the XPath literal)
    await setValue(await byLabel(creator.page, 'Token name'), `Inline Token ${tag}`)
    await setValue(await byLabel(creator.page, 'Symbol'), 'INL')
    await clickText(creator.page, 'Create & mint')
    await waitText(creator.page, 'Test token created and selected', 90_000)
    await waitText(creator.page, 'INL')
    await shot(creator.page, '01c-wizard-inline-token')
    ok('create a test token inside the wizard, address filled automatically')

    console.log('\n[Create Merkle airdrop]')
    const merkleName = `UI Merkle ${tag}`
    await startWizard(creator.page, 'Merkle airdrop')
    const fileInput = await creator.page.waitForSelector('input[type=file]')
    await (fileInput as ElementHandle<HTMLInputElement>).uploadFile(csvFile('merkle.csv', `address,amount\n${ALICE},100\n${BOB},50.5\n`))
    await clickText(creator.page, 'Build Merkle tree')
    await waitText(creator.page, '2 recipients')
    ok('upload CSV -> wallet sign-in -> Merkle tree built')
    await setWindow(creator.page)
    await shot(creator.page, '02-merkle-distribution')
    const merkleAddr = await finishWizard(creator.page, merkleName, '03-merkle')
    ok(`deployed ${merkleAddr}`)

    await creator.page.goto(`${BASE}/projects/${merkleAddr}`, { waitUntil: 'networkidle0' })
    await waitText(creator.page, merkleName)
    await waitText(creator.page, 'Replace recipient list')   // creator sees Manage by default
    await shot(creator.page, '04-merkle-project-creator')
    ok('project page (creator view, with management panel)')

    console.log('\n[alice claims Merkle]')
    await claimFromClaimPage(alice.page, merkleName)
    await shot(alice.page, '05-alice-claimed-merkle')
    ok('alice claims 100 TT on the Claim page')

    console.log('\n[Create signature airdrop]')
    const signName = `UI Signature ${tag}`
    await startWizard(creator.page, 'Signature airdrop')
    await clickText(creator.page, 'Generate signer key')
    await waitText(creator.page, 'Brand-new empty account')
    const signFile = await creator.page.waitForSelector('input[type=file]')
    await (signFile as ElementHandle<HTMLInputElement>).uploadFile(csvFile('sign.csv', `${ALICE},20\n`))
    await setWindow(creator.page)
    await setValue(await byLabel(creator.page, 'Deposit amount (TT)'), '500')
    await shot(creator.page, '06-sign-distribution')
    const signAddr = await finishWizard(creator.page, signName, '07-sign')
    ok(`signer key generated + deployed + list auto-uploaded ${signAddr}`)

    console.log('\n[Create vesting]')
    const vestName = `UI Vesting ${tag}`
    await startWizard(creator.page, 'Vesting')
    await setValue(await byLabel(creator.page, 'Beneficiary'), ALICE)
    await setValue(await byLabel(creator.page, 'Amount (TT)'), '1000')
    await setValue(await byLabel(creator.page, 'TGE date'), localInput(new Date(Date.now() - 86400_000)))
    await setValue(await byLabel(creator.page, 'Cliff (days)'), '0')
    await setValue(await byLabel(creator.page, 'Vesting (days)'), '30')
    await setValue(await byLabel(creator.page, 'Every (days)'), '0')
    await clickText(creator.page, 'Validate schedules')
    await waitText(creator.page, 'Schedules are valid')
    await shot(creator.page, '08-vesting-distribution')
    const vestAddr = await finishWizard(creator.page, vestName, '09-vesting')
    ok(`schedules entered manually + deployed ${vestAddr}`)

    console.log('\n[alice claims signature airdrop and vesting]')
    await claimFromClaimPage(alice.page, signName)
    ok('alice claims signature airdrop (backend signs -> on-chain claim)')
    await claimFromClaimPage(alice.page, vestName)
    await shot(alice.page, '10-alice-claim-page')
    ok('alice claims the unlocked vesting amount')

    console.log('\n[Creator manages signature airdrop list]')
    await creator.page.goto(`${BASE}/projects/${signAddr}`, { waitUntil: 'networkidle0' })
    await waitText(creator.page, 'Recipient list')
    await setValue(await byLabel(creator.page, 'Add one address'), BOB)
    await setValue(await byLabel(creator.page, 'Amount (TT)'), '7')
    await clickText(creator.page, 'Add', true)
    await waitText(creator.page, '2 recipients')
    ok('add bob to the list live')
    await clickText(creator.page, 'Pause claims')
    await waitText(creator.page, 'Claims are paused', 60_000)
    await shot(creator.page, '11-sign-manage-paused')
    ok('pause claims')
    await clickText(creator.page, 'Resume claims')
    await waitText(creator.page, 'Pause claims', 60_000)
    ok('resume claims')

    console.log('\n[alice sees her allocation on the project page]')
    await alice.page.goto(`${BASE}/projects/${vestAddr}`, { waitUntil: 'networkidle0' })
    await waitText(alice.page, 'Your allocation')
    await waitText(alice.page, 'Schedule #0')
    await shot(alice.page, '12-alice-vesting-project')
    ok('vesting project page shows alice\'s schedule progress')

    console.log('\n[Stats]')
    await creator.page.goto(BASE, { waitUntil: 'networkidle0' })
    await waitText(creator.page, merkleName)
    await creator.page.hover('svg rect[tabindex="0"]:last-of-type').catch(() => {})
    await shot(creator.page, '13-home-after')
    ok('home stats + latest projects')

    await creator.page.setViewport({ width: 390, height: 844 })
    await creator.page.goto(`${BASE}/projects/${merkleAddr}`, { waitUntil: 'networkidle0' })
    await shot(creator.page, '14-mobile-project')
    ok('renders at mobile width')

    console.log(`\nAll passed: ${passed} checks ✅  Screenshots: ${SHOTS}`)
  } catch (e) {
    await shot(creator.page, 'zz-fail-creator').catch(() => {})
    await shot(alice.page, 'zz-fail-alice').catch(() => {})
    throw e
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
