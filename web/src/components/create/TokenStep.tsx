'use client'
import { useState } from 'react'
import { isAddress } from 'viem'
import { ChevronDown, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { CardBody, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Notice } from '@/components/ui/Feedback'
import { CreateTestToken, TEST_TOKEN_SUPPLY_LABEL } from '@/components/test-token/CreateTestToken'
import { formatToken } from '@/lib/client/format'
import { TEST_TOKEN_FACTORY } from '@/config/chain'
import type { Patch, TokenInfo, WizardState } from './types'

export function TokenStep({ s, patch, token, loading }: { s: WizardState; patch: Patch; token: TokenInfo | null; loading: boolean }) {
  const valid = isAddress(s.token, { strict: false })
  const [showTest, setShowTest] = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  return (
    <>
      <CardHeader><h2 className="font-display font-semibold text-ink">Token</h2></CardHeader>
      <CardBody className="space-y-4">
        <Input
          label="Token contract address"
          placeholder="0x…"
          value={s.token}
          onChange={(e) => patch({ token: e.target.value.trim(), merkle: null, vesting: null })}
          error={s.token && !valid ? 'Not a valid address' : undefined}
          spellCheck={false}
        />
        {valid && loading && <p className="text-xs text-muted">Reading token…</p>}
        {valid && !loading && !token && (
          <Notice tone="error">Could not read this token. Make sure it is an ERC-20 on this network.</Notice>
        )}
        {token && (
          <div className="rounded-btn border border-border p-3 text-sm flex items-center justify-between">
            <div>
              <div className="font-medium text-ink">{token.symbol}</div>
              <div className="text-xs text-muted">{token.name} · {token.decimals} decimals</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Your balance</div>
              <div className="font-mono-data">{formatToken(token.balance, token.decimals)}</div>
            </div>
          </div>
        )}
        {justCreated && token && s.token.toLowerCase() === justCreated && (
          <Notice tone="success">Test token created and selected. You&apos;re ready for the next step.</Notice>
        )}

        {TEST_TOKEN_FACTORY && (
          <div className="rounded-btn border border-dashed border-border">
            <button
              type="button"
              onClick={() => setShowTest(!showTest)}
              aria-expanded={showTest}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-[6px] bg-blue-light text-blue-text flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
                <span>
                  <span className="block text-sm font-medium text-ink">Don&apos;t have a token yet?</span>
                  <span className="block text-xs text-muted">Create a test token and get {TEST_TOKEN_SUPPLY_LABEL} in one transaction.</span>
                </span>
              </span>
              <ChevronDown size={16} className={clsx('text-muted transition-transform shrink-0', showTest && 'rotate-180')} />
            </button>
            {showTest && (
              <div className="px-4 pb-4 pt-1 border-t border-border">
                <div className="pt-3">
                  <CreateTestToken compact onCreated={(t) => {
                    patch({ token: t.address, merkle: null, vesting: null })
                    setJustCreated(t.address.toLowerCase())
                    setShowTest(false)
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        <Notice tone="info">Fee-on-transfer and rebasing tokens are not supported.</Notice>
      </CardBody>
    </>
  )
}
