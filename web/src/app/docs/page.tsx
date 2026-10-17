/**
 * /docs — product overview and user guide (creators, recipients, testers).
 * Static server component; the sidebar's active-section highlight is a small client component.
 */
import Link from 'next/link'
import { explorerAddress, NETWORK_KEYS, NETWORKS, type NetworkConfig } from '@/config/networks'
import { DocsToc, type TocItem } from '@/components/docs/DocsToc'

export const metadata = { title: 'Docs' }

const TOC: TocItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'types', label: 'Choosing a type' },
  { id: 'merkle', label: 'Merkle airdrop' },
  { id: 'signature', label: 'Signature airdrop' },
  { id: 'vesting', label: 'Vesting' },
  { id: 'claiming', label: 'Claiming tokens' },
  { id: 'managing', label: 'Managing a project' },
  { id: 'csv', label: 'CSV formats' },
  { id: 'test-tokens', label: 'Test tokens' },
  { id: 'networks', label: 'Networks' },
  { id: 'wallet', label: 'Wallet setup' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contracts', label: 'Contracts' },
]

export default function DocsPage() {
  return (
    <div className="grid lg:grid-cols-[180px_1fr] gap-10 items-start">
      <DocsToc items={TOC} />

      <article className="min-w-0 max-w-3xl space-y-14">
        <header className="space-y-2">
          <h1 className="font-display font-bold text-3xl text-ink tracking-tight-display">Documentation</h1>
          <p className="text-muted leading-relaxed">
            Everything you need to distribute tokens with TokenShoe on Arc, whether you are launching a
            project or claiming from one.
          </p>
        </header>

        <Section id="overview" title="Overview">
          <P>
            TokenShoe lets a project deploy a token distribution contract in <B>a single transaction</B>. Recipients
            then claim their tokens themselves from the <A href="/claim">Claim</A> page.
          </P>
          <P>
            The core promise: <B>creators can&apos;t take back what recipients are owed.</B> For airdrops, unclaimed
            tokens can only be withdrawn after the claim window closes. For vesting, only tokens not allocated to anyone
            can be withdrawn.
          </P>
          <Callout>
            Every project is its own small contract, created by the TokenShoe factory. Tokens sit in that contract,
            not with TokenShoe — the platform never holds your funds.
          </Callout>
        </Section>

        <Section id="quick-start" title="Quick start">
          <Steps items={[
            <>Pick a network in the top-right corner (<B>Arc Testnet</B> to try things out for free), then connect a wallet. Gas on Arc is paid in USDC — click <B>Faucet</B> next to the wallet button: it copies your address and opens the <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="text-blue-text underline underline-offset-2">Circle faucet</a>.</>,
            <>No token yet? <A href="/test-token">Mint a free test token</A> — 100,000,000 tokens land in your wallet.</>,
            <>Open <A href="/create">Create</A>, pick a distribution type, paste your token address and upload your list.</>,
            <>Confirm two wallet prompts: <B>approve</B> (lets the factory move your tokens) and <B>create</B> (deploys the project and deposits the tokens).</>,
            <>Share the project link. Recipients connect their wallet on the <A href="/claim">Claim</A> page and claim.</>,
          ]} />
        </Section>

        <Section id="types" title="Choosing a type">
          <Table
            head={['Type', 'Best for', 'Can the list change?']}
            rows={[
              ['Merkle airdrop', 'A fixed list, any size (100k+ addresses). Cheapest on-chain.', 'Only before the claim window opens'],
              ['Signature airdrop', 'Lists that change: quests, allowlists, off-chain conditions.', 'Any time, instantly'],
              ['Vesting', 'Team, investors, advisors: TGE unlock, cliff, then gradual release.', 'Add schedules any time; revoke revocable ones'],
            ]}
          />
        </Section>

        <Section id="merkle" title="Merkle airdrop">
          <P>
            You upload a CSV of addresses and amounts. TokenShoe builds a Merkle tree and stores only its root on-chain;
            each recipient claims with a proof the site fetches for them.
          </P>
          <H3>Settings</H3>
          <Dl items={[
            ['Recipient list', 'CSV with address,amount. Amounts are in whole tokens; decimals are allowed (e.g. 25.5).'],
            ['Claim opens / closes', 'The claim window, in your local time zone. Defaults: opens in 1 hour, closes 30 days later.'],
            ['Deposit amount', 'How many tokens to put in. It must cover the list total; you can top up later.'],
          ]} />
          <Callout>
            Made a mistake? You can replace the whole list from the project&apos;s Manage tab — but only <B>before</B> the
            claim window opens.
          </Callout>
        </Section>

        <Section id="signature" title="Signature airdrop">
          <P>
            Instead of a fixed list, the TokenShoe backend signs each claim with a <B>signer key</B> that belongs to your
            project. You can add, edit or remove recipients at any time and the change applies immediately.
          </P>
          <H3>The signer key</H3>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink/90 leading-relaxed">
            <li>Click <B>Generate</B> on the create page to make a brand-new key, and download the backup.</li>
            <li>It must be a fresh account with no funds and no transactions. It is only used to sign claims, never to send transactions.</li>
            <li>The backend stores it encrypted. If it ever leaks, use <B>Rotate signer</B> in the Manage tab.</li>
          </ul>
          <H3>Editing the list</H3>
          <P>
            In the project&apos;s Manage tab, upload a CSV (merge into or replace the current list) or edit single
            recipients. If you raise the amount for someone who already claimed, they can claim the difference.
          </P>
          <Callout tone="warn">
            A signature handed out to a recipient stays valid for up to 30 minutes. If you lower someone&apos;s amount
            and need it to apply instantly, rotate the signer.
          </Callout>
        </Section>

        <Section id="vesting" title="Vesting">
          <P>
            Each beneficiary gets a <B>schedule</B>: part unlocks at TGE, then nothing for a cliff period, then the rest
            unlocks gradually. Enter schedules by hand or upload a CSV.
          </P>
          <VestingTimeline />
          <Dl items={[
            ['TGE date', 'When the first part unlocks. Your local time zone.'],
            ['Unlocked at TGE (%)', 'Share released at TGE, 0–100.'],
            ['Cliff (days)', 'Waiting time after TGE during which nothing more unlocks.'],
            ['Vesting (days)', 'How long it takes to release the rest after the cliff.'],
            ['Every (days)', 'Release step. 30 = a batch every 30 days. 0 = continuous, every second.'],
            ['Revocable', 'If on, you can stop the schedule later. Tokens already unlocked still belong to the beneficiary.'],
          ]} />
          <H3>Example</H3>
          <P>
            1,000 tokens, 10% at TGE, cliff 90, vesting 360, every 30: 100 tokens at TGE, nothing for 90 days, then 75
            tokens every 30 days for 12 months.
          </P>
          <Callout>
            Testing with minutes instead of days? Day fields accept decimals: 1 minute ≈ <Code>0.000694</Code>, 5 minutes
            ≈ <Code>0.00347</Code>, 1 hour ≈ <Code>0.0417</Code>. Set the TGE date to now so it starts right away.
          </Callout>
        </Section>

        <Section id="claiming" title="Claiming tokens">
          <Steps items={[
            <>Open <A href="/claim">Claim</A> and connect the wallet that is on the list.</>,
            <>Everything you can claim — from every project and every type — is shown in one place.</>,
            <>Click <B>Claim</B> and confirm in your wallet. You only pay gas.</>,
          ]} />
          <P>
            For vesting, claim as often as you like; each time you receive what has unlocked so far. Past claims are in
            the <B>History</B> tab.
          </P>
        </Section>

        <Section id="managing" title="Managing a project">
          <P>
            Open your project from <A href="/projects">My projects</A>. As the creator you get a <B>Manage</B> tab
            (you&apos;ll be asked to sign a free message to prove you own the wallet):
          </P>
          <Table
            head={['Action', 'What it does']}
            rows={[
              ['Top up', 'Deposit more tokens. Anyone can top up a project.'],
              ['Pause / resume', 'Stops claims temporarily. For airdrops, the window is extended by the paused time.'],
              ['Withdraw', 'Take back what is recoverable: airdrop leftovers after the window closes, or vesting surplus.'],
              ['Edit details', 'Name, description and links shown on the project page.'],
              ['List / schedules', 'Merkle: replace before start. Signature: edit any time, rotate signer. Vesting: add or revoke.'],
            ]}
          />
        </Section>

        <Section id="csv" title="CSV formats">
          <P>Download a template from the create page, or copy these. The first row is the header.</P>
          <H3>Airdrops (Merkle and signature)</H3>
          <Pre>{`address,amount
0x1111111111111111111111111111111111111111,100
0x2222222222222222222222222222222222222222,25.5`}</Pre>
          <H3>Vesting</H3>
          <Pre>{`beneficiary,amount,tge_time,tge_percent,cliff_days,vesting_days,interval_days,revocable
0x1111111111111111111111111111111111111111,100000,2026-12-01,10,90,360,30,false`}</Pre>
          <Dl items={[
            ['tge_time', 'YYYY-MM-DD (00:00 UTC), ISO time with zone (2026-12-01T08:00:00Z), or unix seconds.'],
            ['*_days', 'Days; decimals allowed. interval_days must not exceed vesting_days.'],
            ['revocable', 'true / false / yes / no / 1 / 0'],
          ]} />
          <P>Limits: up to 100,000 rows and 4 MB per airdrop file; up to 500 vesting schedules per transaction.</P>
        </Section>

        {NETWORK_KEYS.some((k) => NETWORKS[k].testTokenFactory) && (
          <Section id="test-tokens" title="Test tokens">
            <P>
              Open <A href="/test-token">Test tokens</A> and enter a name and symbol to deploy your own ERC-20 with 18 decimals
              and receive 100,000,000 tokens. They have no value — use them to try every distribution type. Tip: add a
              second wallet of yours to the list so you can test claiming too.
            </P>
          </Section>
        )}

        <Section id="networks" title="Networks">
          <P>
            TokenShoe runs on <B>Arc Testnet</B> (free test tokens, for trying things out) and <B>Arc Mainnet</B> (real
            assets). Switch with the network menu in the top-right corner. Each network has its own contracts and its
            own data: projects, lists and stats on one never show up on the other.
          </P>
          <Callout>
            Sharing a project link? Add <Code>?network=mainnet</Code> (or <Code>testnet</Code>) so it opens on the right network.
          </Callout>
        </Section>

        <Section id="wallet" title="Wallet setup">
          <P>The site asks your wallet to add and switch networks for you. To set one up by hand:</P>
          <Table
            head={['', ...NETWORK_KEYS.map((k) => NETWORKS[k].label)]}
            rows={[
              ['Chain ID', ...NETWORK_KEYS.map((k) => String(NETWORKS[k].chain.id))],
              ['RPC URL', ...NETWORK_KEYS.map((k) => NETWORKS[k].chain.rpcUrls.default.http[0])],
              ['Explorer', ...NETWORK_KEYS.map((k) => NETWORKS[k].explorerUrl)],
              ['Currency', ...NETWORK_KEYS.map(() => 'USDC')],
            ]}
          />
          <Callout tone="warn">
            Seeing &ldquo;Requested resource not available&rdquo;? Your wallet&apos;s saved RPC for this network is
            unreachable. Accept the site&apos;s prompt to switch, or set the RPC URL above in your wallet&apos;s network
            settings.
          </Callout>
        </Section>

        <Section id="faq" title="FAQ">
          <Faq q="Why two wallet prompts when creating?">
            The first (approve) allows the factory to move your tokens; the second creates the project and deposits them.
            If you already approved enough, the first is skipped.
          </Faq>
          <Faq q="Can I get my tokens back if nobody claims?">
            Airdrops: yes, after the claim window closes, from the Manage tab. Vesting: only the surplus not assigned to
            any schedule, plus whatever revoking frees up.
          </Faq>
          <Faq q="I'm on the list but see nothing on the Claim page.">
            Check you connected the exact address from the list, and that the claim window (or TGE) has started.
          </Faq>
          <Faq q="Does TokenShoe charge fees?">
            No platform fee. You only pay network gas.
          </Faq>
        </Section>

        <Section id="contracts" title="Contracts">
          <P>Each project is a minimal-proxy clone (EIP-1167) created by the factory, so deploying one is cheap.</P>
          {NETWORK_KEYS.map((k) => <ContractList key={k} n={NETWORKS[k]} />)}
        </Section>
      </article>
    </div>
  )
}

/* ---------- Building blocks ---------- */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} data-doc-section className="scroll-mt-24 space-y-4">
      <h2 className="font-display font-semibold text-xl text-ink tracking-tight-display">
        <a href={`#${id}`} className="hover:underline decoration-border underline-offset-4">{title}</a>
      </h2>
      {children}
    </section>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-ink pt-2">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink/90 leading-relaxed">{children}</p>
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-blue-text underline underline-offset-2">{children}</Link>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.85em] bg-black/[0.05] px-1 py-0.5 rounded">{children}</code>
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="font-mono text-xs bg-surface border border-border rounded-card p-4 overflow-x-auto leading-relaxed text-ink">
      {children}
    </pre>
  )
}

function Callout({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  const cls = tone === 'warn' ? 'bg-yellow-light text-yellow-text' : 'bg-blue-light text-blue-text'
  return <div className={`${cls} rounded-card px-4 py-3 text-sm leading-relaxed`}>{children}</div>
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-6 h-6 rounded-full bg-ink text-white text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
          <span className="text-sm text-ink/90 leading-relaxed pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  )
}

function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="bg-surface border border-border rounded-card divide-y divide-border">
      {items.map(([k, v]) => (
        <div key={k} className="grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 px-4 py-3 text-sm">
          <dt className="font-medium text-ink">{k}</dt>
          <dd className="text-muted leading-relaxed break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="bg-surface border border-border rounded-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((h) => <th key={h} className="px-4 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => <td key={i} className={`px-4 py-3 align-top leading-relaxed ${i === 0 ? 'font-medium text-ink whitespace-nowrap' : 'text-muted'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group bg-surface border border-border rounded-card px-4 py-3">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-medium text-ink">
        {q}
        <span className="text-muted transition-transform group-open:rotate-45 text-lg leading-none">+</span>
      </summary>
      <p className="text-sm text-muted leading-relaxed mt-2">{children}</p>
    </details>
  )
}

/** Contract addresses of one network (or "coming soon") */
function ContractList({ n }: { n: NetworkConfig }) {
  const rows: [string, React.ReactNode][] = n.factory
    ? [
        ['Factory', <AddrLink key="f" n={n} address={n.factory} />],
        ...(n.testTokenFactory ? [['Test token factory', <AddrLink key="t" n={n} address={n.testTokenFactory} />] as [string, React.ReactNode]] : []),
      ]
    : [['Factory', 'Coming soon']]
  return (
    <>
      <H3>{n.label}</H3>
      <Dl items={rows} />
    </>
  )
}

function AddrLink({ n, address }: { n: NetworkConfig; address: string }) {
  return (
    <a href={explorerAddress(n, address)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-ink hover:text-blue-text break-all">
      {address}
    </a>
  )
}

/** Schematic of a vesting schedule: TGE step, flat cliff, stepped release. */
function VestingTimeline() {
  return (
    <figure className="bg-surface border border-border rounded-card p-4 space-y-2">
      <svg viewBox="0 0 400 130" className="w-full h-auto" role="img" aria-label="Unlocked amount over time: a jump at TGE, flat during the cliff, then steps up to 100%">
        <line x1="30" y1="105" x2="390" y2="105" stroke="#EAEAEA" strokeWidth="1" />
        <line x1="30" y1="15" x2="390" y2="15" stroke="#EAEAEA" strokeWidth="1" strokeDasharray="3 3" />
        <path
          d="M30 105 H70 V93 H150 V93 H180 V78 H210 V63 H240 V48 H270 V33 H300 V15 H390"
          fill="none" stroke="#111111" strokeWidth="2" strokeLinejoin="round"
        />
        <text x="70" y="122" fontSize="10" fill="#787774" textAnchor="middle">TGE</text>
        <text x="110" y="122" fontSize="10" fill="#787774" textAnchor="middle">Cliff</text>
        <text x="225" y="122" fontSize="10" fill="#787774" textAnchor="middle">Vesting</text>
        <text x="345" y="122" fontSize="10" fill="#787774" textAnchor="middle">Fully unlocked</text>
        <text x="26" y="18" fontSize="10" fill="#787774" textAnchor="end">100%</text>
        <text x="26" y="96" fontSize="10" fill="#787774" textAnchor="end">TGE%</text>
      </svg>
      <figcaption className="text-xs text-muted">Unlocked amount over time with a stepped release (Every &gt; 0). With Every = 0 the vesting part is a straight line.</figcaption>
    </figure>
  )
}
