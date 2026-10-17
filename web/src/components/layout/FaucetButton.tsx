'use client'
/**
 * Nav "Faucet" button: sends users to Circle's public faucet for testnet USDC (Arc's gas token).
 * Circle's faucet has a captcha, so we can't claim for the user; instead we copy the connected wallet
 * address to the clipboard and open the faucet in a new tab, ready to paste.
 * It is a real link (not window.open) so popup blockers never stop the new tab.
 */
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { Droplet } from 'lucide-react'
import { useNetwork } from '@/hooks/useNetwork'

const CIRCLE_FAUCET = 'https://faucet.circle.com'

/** variant: 'button' = nav bar pill (label from xl up), 'menu' = full-width row in the mobile menu */
export function FaucetButton({ variant = 'button' }: { variant?: 'button' | 'menu' }) {
  const { address } = useAccount()
  const { network } = useNetwork()

  // Runs on click; the link itself opens the faucet tab (no preventDefault)
  function copyAndHint() {
    // Start the clipboard write synchronously, while this page still has focus
    // (navigator.clipboard is missing on plain-http pages other than localhost, so guard it)
    const copied = address && navigator.clipboard
      ? navigator.clipboard.writeText(address).then(() => true, () => false)
      : Promise.resolve(false)
    copied.then((ok) => {
      toast.message(ok ? 'Your address is copied' : "Opened Circle's faucet", {
        description: `On the faucet page choose ${network.label}, ${ok ? 'paste your address' : 'enter your wallet address'} and request USDC. Limit: once per 24 hours.`,
        duration: 8000,
      })
    })
  }

  return (
    <a
      href={CIRCLE_FAUCET}
      target="_blank"
      rel="noopener noreferrer"
      onClick={copyAndHint}
      title="Get free test USDC for gas from Circle's faucet"
      className={variant === 'menu'
        ? 'flex items-center gap-2 px-3 py-2 rounded-btn text-sm font-medium text-ink hover:bg-black/5'
        : 'inline-flex items-center gap-1.5 h-10 px-3 rounded-[12px] text-sm font-medium text-ink bg-surface border border-border hover:bg-black/[0.03] transition-colors'}
    >
      <Droplet size={14} className="text-blue-text" />
      {variant === 'menu' ? 'Get test USDC (faucet)' : <span className="hidden xl:inline">Faucet</span>}
    </a>
  )
}
