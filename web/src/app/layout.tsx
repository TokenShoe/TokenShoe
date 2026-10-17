import type { Metadata } from 'next'
import Link from 'next/link'
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/components/providers/AppProviders'
import { Nav } from '@/components/layout/Nav'
import { WalletNetworkBanner } from '@/components/layout/WalletNetworkBanner'

const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const body = DM_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'TokenShoe — Token distribution on Arc', template: '%s · TokenShoe' },
  description: 'Deploy Merkle airdrops, signature-gated drops and vesting schedules in one transaction.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas font-body">
        <AppProviders>
          <Nav />
          <WalletNetworkBanner />
          <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">{children}</main>
          <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-xs text-muted">
            TokenShoe · Open-source token distribution contracts on Arc ·{' '}
            <Link href="/docs" className="hover:text-ink underline underline-offset-2">Docs</Link>
          </footer>
        </AppProviders>
      </body>
    </html>
  )
}
