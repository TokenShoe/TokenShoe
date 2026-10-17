/**
 * Chain access for the current API request's network: read-only client + contract addresses + common on-chain reads.
 * The backend only reads from the chain and never sends transactions (signature airdrops are signed off-chain; users submit the tx).
 */
import { createPublicClient, http, getAddress, type Address, type PublicClient } from 'viem'
import { env } from './env'
import { ERC20_ABI } from './abis'
import { ApiError } from './http'
import { NETWORKS, type NetworkKey, type NetworkConfig } from '@/config/networks'
import { currentNetworkKey } from './request-network'

/** Chain of the current request's network */
export const chain = () => NETWORKS[currentNetworkKey()].chain

const SERVER_RPC: Record<NetworkKey, string | undefined> = { testnet: env.RPC_URL, mainnet: env.MAINNET_RPC_URL }

const clients: Partial<Record<NetworkKey, PublicClient>> = {}

/** Read-only client of the current request's network */
export function publicClient(): PublicClient {
  const key = currentNetworkKey()
  // batch: true - concurrent reads are merged into one JSON-RPC batch to save round trips
  return (clients[key] ??= createPublicClient({
    chain: NETWORKS[key].chain,
    transport: http(SERVER_RPC[key] ?? NETWORKS[key].chain.rpcUrls.default.http[0], { batch: true }),
  }) as PublicClient)
}

const IMPL_OVERRIDES: Record<NetworkKey, Partial<Record<'merkle' | 'sign' | 'vesting', string>>> = {
  testnet: { merkle: env.MERKLE_IMPL, sign: env.SIGN_IMPL, vesting: env.VESTING_IMPL },
  mainnet: { merkle: env.MAINNET_MERKLE_IMPL, sign: env.MAINNET_SIGN_IMPL, vesting: env.MAINNET_VESTING_IMPL },
}

function implsOf(key: NetworkKey, n: NetworkConfig): NonNullable<NetworkConfig['impls']> | null {
  const o = IMPL_OVERRIDES[key]
  const pick = (k: 'merkle' | 'sign' | 'vesting') => (o[k] ?? n.impls?.[k])?.toLowerCase() as Address | undefined
  const merkle = pick('merkle'), sign = pick('sign'), vesting = pick('vesting')
  return merkle && sign && vesting ? { merkle, sign, vesting } : null
}

/** TokenShoe contracts on the current request's network; 503 NETWORK_NOT_DEPLOYED if they aren't deployed there */
export function contracts(): { factory: Address; impls: NonNullable<NetworkConfig['impls']> } {
  const key = currentNetworkKey()
  const n = NETWORKS[key]
  const impls = implsOf(key, n)
  if (!n.factory || !impls) throw new ApiError(503, 'NETWORK_NOT_DEPLOYED', `TokenShoe contracts are not deployed on ${n.label} yet`)
  return { factory: n.factory, impls }
}

/** Read an ERC-20's symbol / name / decimals; non-standard tokens fall back to defaults */
export async function readTokenInfo(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    publicClient().readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    publicClient().readContract({ address: token, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
    publicClient().readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => null),
  ])
  return {
    symbol: symbol?.slice(0, 32) ?? null,
    name: name?.slice(0, 120) ?? null,
    decimals: decimals ?? null,
  }
}

/**
 * Check whether an address is a project cloned by our factory (EIP-1167 minimal proxy bytecode embeds the implementation address).
 * Used to detect projects that exist on-chain but are not in the DB yet.
 */
export async function detectCloneImpl(addr: Address): Promise<'merkle' | 'sign' | 'vesting' | null> {
  const code = (await publicClient().getCode({ address: addr }))?.toLowerCase()
  if (!code) return null
  for (const [type, impl] of Object.entries(contracts().impls)) {
    if (code === `0x363d3d373d3d3d363d73${impl.slice(2)}5af43d82803e903d91602b57fd5bf3`) {
      return type as 'merkle' | 'sign' | 'vesting'
    }
  }
  return null
}

export { getAddress }
