/**
 * Make sure the connected wallet can actually reach our chain through ITS OWN RPC setting.
 *
 * Wallets send transactions via the RPC URL saved in the wallet, not the site's. If a user added
 * Arc Testnet with a dead RPC (e.g. rpc.testnet.arc.network), every transaction fails with an opaque
 * "Requested resource not available". A site cannot silently edit wallet settings, but it can suggest
 * our RPC with wallet_addEthereumChain; wallets such as MetaMask then ask the user to add/switch to it.
 */
import { numberToHex, type Chain } from 'viem'

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export type WalletNetworkState = 'ok' | 'wrong-chain' | 'rpc-down'

const PROBE_TIMEOUT_MS = 8_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

/** Ask the wallet for its chain id and latest block. Both go through the wallet's own RPC. */
export async function probeWallet(provider: Eip1193, appChain: Chain): Promise<WalletNetworkState> {
  try {
    const chainId = await withTimeout(provider.request({ method: 'eth_chainId' }), PROBE_TIMEOUT_MS)
    if (Number(chainId) !== appChain.id) return 'wrong-chain'
    await withTimeout(provider.request({ method: 'eth_blockNumber' }), PROBE_TIMEOUT_MS)
    return 'ok'
  } catch (e) {
    console.warn('[wallet] network probe failed', e)
    return 'rpc-down'
  }
}

/** Suggest our chain config (with our RPC URL) to the wallet, then switch to it. Requires user approval. */
export async function suggestOurNetwork(provider: Eip1193, appChain: Chain): Promise<void> {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: numberToHex(appChain.id),
      chainName: appChain.name,
      nativeCurrency: appChain.nativeCurrency,
      rpcUrls: appChain.rpcUrls.default.http,
      blockExplorerUrls: appChain.blockExplorers ? [appChain.blockExplorers.default.url] : undefined,
    }],
  })
  // Most wallets switch after adding; some don't, so ask explicitly (ignore failures)
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(appChain.id) }] }).catch(() => {})
}

/**
 * Probe, and if the wallet's RPC is broken, suggest our RPC once and probe again.
 * Returns the final state; never throws.
 */
export async function ensureWalletNetwork(provider: Eip1193, appChain: Chain): Promise<WalletNetworkState> {
  const first = await probeWallet(provider, appChain)
  if (first !== 'rpc-down') return first
  try {
    await suggestOurNetwork(provider, appChain)
  } catch (e) {
    console.warn('[wallet] wallet_addEthereumChain was rejected or unsupported', e)
    return 'rpc-down'
  }
  return probeWallet(provider, appChain)
}
