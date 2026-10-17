import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { motion } from 'framer-motion'
import { Layers, Send, Lock, ArrowRight, Github } from 'lucide-react'
import CreateWizard from './components/CreateWizard'
import ClaimPage from './components/ClaimPage'
import MyProjects from './components/MyProjects'

type Tab = 'home' | 'create' | 'claim' | 'projects'

export default function App() {
  const { isConnected } = useAccount()
  const [tab, setTab] = useState<Tab>('home')

  return (
    <div className="min-h-dvh bg-canvas font-body">
      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-canvas/90 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={() => setTab('home')}
            className="flex items-center gap-2 font-display font-semibold text-ink tracking-tight-display"
          >
            <div className="w-7 h-7 bg-ink rounded-[6px] flex items-center justify-center">
              <Layers size={14} className="text-white" />
            </div>
            TokenDis
          </button>

          <div className="flex items-center gap-2">
            {isConnected && (
              <>
                <NavBtn active={tab === 'create'} onClick={() => setTab('create')}>
                  Create
                </NavBtn>
                <NavBtn active={tab === 'claim'} onClick={() => setTab('claim')}>
                  Claim
                </NavBtn>
                <NavBtn active={tab === 'projects'} onClick={() => setTab('projects')}>
                  My Projects
                </NavBtn>
              </>
            )}
            <ConnectKitButton />
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {tab === 'home' && <HomePage onNavigate={setTab} />}
        {tab === 'create' && <CreateWizard />}
        {tab === 'claim' && <ClaimPage />}
        {tab === 'projects' && <MyProjects />}
      </main>
    </div>
  )
}

function NavBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-btn text-sm font-medium transition-colors ${
        active
          ? 'bg-ink text-white'
          : 'text-muted hover:text-ink hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  )
}

function HomePage({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { isConnected } = useAccount()

  const features = [
    {
      icon: <Layers size={20} />,
      title: 'Merkle Airdrop',
      desc: 'Fixed recipient lists stored off-chain, verified on-chain via Merkle proofs. Scales to 100k+ addresses with minimal gas.',
      color: 'bg-blue-light text-blue-text',
    },
    {
      icon: <Send size={20} />,
      title: 'Signature Airdrop',
      desc: 'Dynamic lists with backend conditions — social tasks, allowlists, Web2 gates. Each claim signed with EIP-712.',
      color: 'bg-green text-green-text',
    },
    {
      icon: <Lock size={20} />,
      title: 'Vesting / Unlock',
      desc: 'Investor, team, and advisor schedules with TGE, cliff, and linear unlock. Revocable or permanent, batch claim.',
      color: 'bg-yellow-light text-yellow-text',
    },
  ]

  return (
    <div className="space-y-16">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="pt-8 space-y-5 max-w-2xl"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-light text-blue-text text-xs font-medium rounded-full tracking-wide uppercase">
          Arc Testnet · Live
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink tracking-tight-display leading-[1.1]">
          Token distribution,
          <br />
          without the overhead
        </h1>
        <p className="text-muted text-lg leading-relaxed max-w-lg">
          Deploy a Merkle airdrop, signature-gated drop, or vesting schedule in a single transaction. 
          Recipients claim what's theirs — you can't take it back.
        </p>
        <div className="flex items-center gap-3 pt-2">
          {isConnected ? (
            <button
              onClick={() => onNavigate('create')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-btn font-medium text-sm hover:bg-accent-hover active:scale-[0.98] transition-all"
            >
              Create a project
              <ArrowRight size={14} />
            </button>
          ) : (
            <ConnectKitButton label="Connect to start" />
          )}
          {isConnected && (
            <button
              onClick={() => onNavigate('claim')}
              className="px-5 py-2.5 border border-border text-ink rounded-btn font-medium text-sm hover:bg-black/5 transition-colors"
            >
              Check my eligibility
            </button>
          )}
        </div>
      </motion.div>

      {/* Feature cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="bg-surface border border-border rounded-card p-6 shadow-card hover:shadow-hover transition-shadow"
          >
            <div className={`w-9 h-9 rounded-[8px] ${f.color} bg-opacity-20 flex items-center justify-center mb-4`}>
              {f.icon}
            </div>
            <h3 className="font-display font-semibold text-ink mb-2">{f.title}</h3>
            <p className="text-muted text-sm leading-relaxed">{f.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* Contract addresses */}
      <div className="bg-surface border border-border rounded-card p-6">
        <h2 className="font-display font-semibold text-ink mb-4 text-sm uppercase tracking-wide">
          Deployed Contracts — Arc Testnet
        </h2>
        <div className="space-y-2">
          {[
            { label: 'Factory', addr: '0x5b696f2dbc9accef620e3a705251e10a89884e8a' },
            { label: 'MerkleDis impl', addr: '0x4c7d655fb8797d1cf1f131474c6b0ec27d9b2a9e' },
            { label: 'SignDis impl', addr: '0x6d75d447cba33239fbc6d4c3e4bab3e2e4bbf723' },
            { label: 'Vesting impl', addr: '0x5d0722675788b69d3ac12c7a9c5e9988f751df82' },
          ].map(({ label, addr }) => (
            <div key={addr} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm text-muted w-28 shrink-0">{label}</span>
              <a
                href={`https://explorer.testnet.arc.io/address/${addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono-data text-xs text-ink hover:text-blue transition-colors truncate"
              >
                {addr}
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
