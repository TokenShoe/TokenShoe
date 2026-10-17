/** Unit tests for the wallet RPC probe / fix logic, using fake EIP-1193 providers. Run: bun test */
import { describe, expect, test } from 'bun:test'
import { ensureWalletNetwork, probeWallet, type Eip1193 } from './walletNetwork'
import { appChain } from '@/config/chain'

const OUR_CHAIN = '0x' + appChain.id.toString(16)

/** A fake wallet whose RPC is broken until our RPC is added (unless the user rejects) */
function fakeWallet(opts: { chainId?: string; rpcWorks: boolean; acceptAdd?: boolean; pendingError?: boolean }) {
  const calls: { method: string; params?: unknown[] }[] = []
  let rpcWorks = opts.rpcWorks
  const provider: Eip1193 = {
    async request({ method, params }) {
      calls.push({ method, params })
      if (method === 'eth_chainId') return opts.chainId ?? OUR_CHAIN
      if (method === 'eth_blockNumber') {
        if (opts.pendingError && !rpcWorks) throw Object.assign(new Error('Request already pending'), { code: -32002 })
        if (!rpcWorks) throw Object.assign(new Error('Requested resource not available'), { code: -32002 })
        return '0x1'
      }
      if (method === 'wallet_addEthereumChain') {
        if (!opts.acceptAdd) throw Object.assign(new Error('User rejected'), { code: 4001 })
        rpcWorks = true
        return null
      }
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error(`unexpected ${method}`)
    },
  }
  return { provider, calls }
}

describe('probeWallet', () => {
  test('healthy wallet -> ok', async () => {
    expect(await probeWallet(fakeWallet({ rpcWorks: true }).provider)).toBe('ok')
  })
  test('other chain -> wrong-chain', async () => {
    expect(await probeWallet(fakeWallet({ chainId: '0x1', rpcWorks: true }).provider)).toBe('wrong-chain')
  })
  test('broken RPC -> rpc-down', async () => {
    expect(await probeWallet(fakeWallet({ rpcWorks: false }).provider)).toBe('rpc-down')
  })
})

describe('ensureWalletNetwork', () => {
  test('healthy wallet is never prompted', async () => {
    const w = fakeWallet({ rpcWorks: true })
    expect(await ensureWalletNetwork(w.provider)).toBe('ok')
    expect(w.calls.some((c) => c.method === 'wallet_addEthereumChain')).toBe(false)
  })

  test('broken RPC: suggests our RPC URL and recovers when the user approves', async () => {
    const w = fakeWallet({ rpcWorks: false, acceptAdd: true })
    expect(await ensureWalletNetwork(w.provider)).toBe('ok')
    const add = w.calls.find((c) => c.method === 'wallet_addEthereumChain')!
    const params = (add.params as { chainId: string; rpcUrls: string[] }[])[0]
    expect(params.chainId).toBe(OUR_CHAIN)
    expect(params.rpcUrls).toEqual(['https://rpc.testnet.arc.io'])
  })

  test('broken RPC and the user rejects -> rpc-down (banner shows)', async () => {
    const w = fakeWallet({ rpcWorks: false, acceptAdd: false })
    expect(await ensureWalletNetwork(w.provider)).toBe('rpc-down')
  })

  test('wallet with a pending request is treated as rpc-down and gets the suggestion', async () => {
    const w = fakeWallet({ rpcWorks: false, acceptAdd: true, pendingError: true })
    expect(await ensureWalletNetwork(w.provider)).toBe('ok')
  })

  test('wrong chain is left to the normal switchChain flow (no prompt here)', async () => {
    const w = fakeWallet({ chainId: '0x1', rpcWorks: true })
    expect(await ensureWalletNetwork(w.provider)).toBe('wrong-chain')
    expect(w.calls.some((c) => c.method === 'wallet_addEthereumChain')).toBe(false)
  })
})
