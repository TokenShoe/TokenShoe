/**
 * Supported networks (Arc Testnet / Arc Mainnet) - shared by browser and server, public information only.
 *
 * Each network has its own chain, contracts and (on the server) its own database.
 * The user picks one in the nav; the browser sends it with every API call (`x-network` header).
 *
 * Overrides (NEXT_PUBLIC_* values are baked in at build time, so rebuild after changing them):
 *   Testnet: NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_EXPLORER_URL /
 *            NEXT_PUBLIC_FACTORY_ADDRESS / NEXT_PUBLIC_TEST_TOKEN_FACTORY (set to '' to hide test tokens)
 *            (local e2e runs point "testnet" at anvil with NEXT_PUBLIC_CHAIN_ID=31337)
 *   Mainnet: NEXT_PUBLIC_MAINNET_RPC_URL / NEXT_PUBLIC_MAINNET_EXPLORER_URL / NEXT_PUBLIC_MAINNET_FACTORY_ADDRESS /
 *            NEXT_PUBLIC_MAINNET_TEST_TOKEN_FACTORY
 * A network without a factory address is "not deployed": it can be selected, but creating projects is disabled.
 */
import { defineChain, type Address, type Chain } from 'viem'

export type NetworkKey = 'testnet' | 'mainnet'
export const NETWORK_KEYS: readonly NetworkKey[] = ['testnet', 'mainnet']
export const DEFAULT_NETWORK: NetworkKey = 'testnet'

export interface NetworkConfig {
  key: NetworkKey
  /** Display name, e.g. "Arc Testnet" */
  label: string
  chain: Chain
  explorerUrl: string
  /** TokenShoeFactory; null = TokenShoe is not deployed on this network yet */
  factory: Address | null
  /** Implementation contracts registered in the factory (server uses them to recognise clones); null = not deployed */
  impls: { merkle: Address; sign: Address; vesting: Address } | null
  /** TestTokenFactory (test helper, on both networks); null = test tokens hidden */
  testTokenFactory: Address | null
  /** Show the Circle faucet button */
  faucet: boolean
}

/** Matches the factory implType */
export const IMPL_TYPE = { merkle: 0, sign: 1, vesting: 2 } as const
export type ProjectKind = keyof typeof IMPL_TYPE

const lower = (a: string) => a.toLowerCase() as Address
/** Address from an env var with a default; an explicitly empty env var means "none" */
const addr = (value: string | undefined, fallback: string | null): Address | null => {
  const v = value ?? fallback
  return v ? lower(v) : null
}

function makeChain(id: number, name: string, rpcUrl: string, explorerUrl: string, testnet: boolean) {
  return defineChain({
    id,
    name,
    // Arc uses USDC as gas
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Explorer', url: explorerUrl } },
    testnet,
  })
}

// ─── Arc Testnet ─────────────────────────────────────────────────────────────

const TESTNET_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002)
const TESTNET_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.testnet.arc.io'
const TESTNET_EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://explorer.testnet.arc.io'
const TESTNET_NAME = TESTNET_ID === 5042002 ? 'Arc Testnet' : TESTNET_ID === 31337 ? 'Localhost' : `Chain ${TESTNET_ID}`

const testnet: NetworkConfig = {
  key: 'testnet',
  label: TESTNET_NAME,
  chain: makeChain(TESTNET_ID, TESTNET_NAME, TESTNET_RPC, TESTNET_EXPLORER, true),
  explorerUrl: TESTNET_EXPLORER,
  factory: addr(process.env.NEXT_PUBLIC_FACTORY_ADDRESS, '0x865F2f2c7b9D557AEa92f70e8eF05E287E7d00b8'),
  impls: {
    merkle: lower('0xAc68198e66f46920125D48fAfA978c5067cE4B15'),
    sign: lower('0x17968730099016e6679911Ad62603e337d3dcc75'),
    vesting: lower('0xC4e6Da6235190422E6BC4d3D7a1E0DEd412E3877'),
  },
  testTokenFactory: addr(process.env.NEXT_PUBLIC_TEST_TOKEN_FACTORY, '0x6F846226c060792d2B4934bF9F83760423811eAd'),
  faucet: true,
}

// ─── Arc Mainnet ─────────────────────────────────────────────────────────────
// Deployed 2026-10-17 by 0xa30Db5ee76e7d4b2B5F8048518EE160B559A56f9 (source of truth: deployments/5042.json)

const MAINNET_RPC = process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io'
const MAINNET_EXPLORER = process.env.NEXT_PUBLIC_MAINNET_EXPLORER_URL ?? 'https://explorer.arc.io'
const MAINNET_FACTORY: string | null = '0x6e79A60Feb913Cd6e1281fF5F5a463345954043b'
const MAINNET_TEST_TOKEN_FACTORY: string | null = '0xAc68198e66f46920125D48fAfA978c5067cE4B15'
const MAINNET_IMPLS: NetworkConfig['impls'] = {
  merkle: lower('0x1C9Ac4647b98677fE645B8f5a6E4cb725F722824'),
  sign: lower('0x663248304204B3ddE9e03355fA3163A23Dc7eE4b'),
  vesting: lower('0xf9eB40fB39e1aD27c987b8206D8eF7fE3503F58a'),
}

const mainnet: NetworkConfig = {
  key: 'mainnet',
  label: 'Arc Mainnet',
  chain: makeChain(5042, 'Arc Mainnet', MAINNET_RPC, MAINNET_EXPLORER, false),
  explorerUrl: MAINNET_EXPLORER,
  factory: addr(process.env.NEXT_PUBLIC_MAINNET_FACTORY_ADDRESS, MAINNET_FACTORY),
  impls: MAINNET_IMPLS,
  // Mainnet test tokens are worthless ERC-20s for trying the platform with real gas
  testTokenFactory: addr(process.env.NEXT_PUBLIC_MAINNET_TEST_TOKEN_FACTORY, MAINNET_TEST_TOKEN_FACTORY),
  // Circle's faucet only hands out testnet USDC
  faucet: false,
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = { testnet, mainnet }

export const isNetworkKey = (v: unknown): v is NetworkKey => typeof v === 'string' && (NETWORK_KEYS as readonly string[]).includes(v)

/** TokenShoe contracts are deployed on this network */
export const isDeployed = (n: NetworkConfig) => n.factory !== null

export const explorerAddress = (n: NetworkConfig, a: string) => `${n.explorerUrl}/address/${a}`
export const explorerTx = (n: NetworkConfig, h: string) => `${n.explorerUrl}/tx/${h}`
