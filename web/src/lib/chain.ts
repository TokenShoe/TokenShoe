/**
 * Chain access: read-only client + contract addresses + common on-chain reads.
 * The backend only reads from the chain and never sends transactions (signature airdrops are signed off-chain; users submit the tx).
 */
import { createPublicClient, http, getAddress, type Address } from 'viem'
import { env } from './env'
import { ERC20_ABI } from './abis'
import { appChain, FACTORY_ADDRESS } from '@/config/chain'

export const chain = appChain

// batch: true - concurrent reads are merged into one JSON-RPC batch to save round trips
export const publicClient = createPublicClient({
  chain,
  transport: http(env.RPC_URL ?? chain.rpcUrls.default.http[0], { batch: true }),
})

export const CONTRACTS = {
  factory: FACTORY_ADDRESS,
  impls: {
    merkle: env.MERKLE_IMPL.toLowerCase() as Address,
    sign: env.SIGN_IMPL.toLowerCase() as Address,
    vesting: env.VESTING_IMPL.toLowerCase() as Address,
  },
}

/** Read an ERC-20's symbol / name / decimals; non-standard tokens fall back to defaults */
export async function readTokenInfo(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => null),
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
  const code = (await publicClient.getCode({ address: addr }))?.toLowerCase()
  if (!code) return null
  for (const [type, impl] of Object.entries(CONTRACTS.impls)) {
    if (code === `0x363d3d373d3d3d363d73${impl.slice(2)}5af43d82803e903d91602b57fd5bf3`) {
      return type as 'merkle' | 'sign' | 'vesting'
    }
  }
  return null
}

export { getAddress }
