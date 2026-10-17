/**
 * Chain and contract config - shared by browser and server (public information only).
 * Override with NEXT_PUBLIC_* environment variables; defaults to Arc Testnet.
 * Note: NEXT_PUBLIC_* values are baked into the frontend at build time, so rebuild after changing them.
 */
import { defineChain, type Address } from 'viem'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002)
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.testnet.arc.io'
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://explorer.testnet.arc.io'

export const appChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 5042002 ? 'Arc Testnet' : CHAIN_ID === 31337 ? 'Localhost' : `Chain ${CHAIN_ID}`,
  // Arc uses USDC as gas
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Explorer', url: EXPLORER_URL } },
  testnet: true,
})

export const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? '0x865F2f2c7b9D557AEa92f70e8eF05E287E7d00b8'
).toLowerCase() as Address

/** Matches the factory implType */
export const IMPL_TYPE = { merkle: 0, sign: 1, vesting: 2 } as const
export type ProjectKind = keyof typeof IMPL_TYPE

export const explorerAddress = (a: string) => `${EXPLORER_URL}/address/${a}`
export const explorerTx = (h: string) => `${EXPLORER_URL}/tx/${h}`

/**
 * Testnet helper that mints a 100M test ERC-20 to the caller.
 * Unset -> the Arc Testnet deployment; set to an empty string -> feature hidden (e.g. mainnet).
 */
const TEST_TOKEN_FACTORY_RAW = process.env.NEXT_PUBLIC_TEST_TOKEN_FACTORY ?? '0x6F846226c060792d2B4934bF9F83760423811eAd'
export const TEST_TOKEN_FACTORY = TEST_TOKEN_FACTORY_RAW ? (TEST_TOKEN_FACTORY_RAW as Address) : null
