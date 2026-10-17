import { createConfig, http } from 'wagmi'
import { getDefaultConfig } from 'connectkit'
import type { Chain } from 'wagmi/chains'

// Arc Testnet chain definition
export const arcTestnet: Chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' },
  },
  testnet: true,
}

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [arcTestnet],
    transports: {
      [arcTestnet.id]: http('https://rpc.testnet.arc.io'),
    },
    walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '',
    appName: 'TokenDis',
    appDescription: 'Token distribution platform — airdrop, sign-based, and vesting',
    appUrl: 'https://tokendis.arc.io',
  }),
)

export const ARC_TESTNET_CHAIN_ID = arcTestnet.id

// Deployed contract addresses — read from .env (set after you run Deploy.s.sol)
// Fallback to the Arc Studio testnet deployment so the UI stays functional before you redeploy.
export const CONTRACTS = {
  factory:     (import.meta.env.VITE_FACTORY     ?? '0x5b696f2dbc9accef620e3a705251e10a89884e8a') as `0x${string}`,
  merkleImpl:  (import.meta.env.VITE_MERKLE_IMPL ?? '0x4c7d655fb8797d1cf1f131474c6b0ec27d9b2a9e') as `0x${string}`,
  signImpl:    (import.meta.env.VITE_SIGN_IMPL   ?? '0x6d75d447cba33239fbc6d4c3e4bab3e2e4bbf723') as `0x${string}`,
  vestingImpl: (import.meta.env.VITE_VESTING_IMPL ?? '0x5d0722675788b69d3ac12c7a9c5e9988f751df82') as `0x${string}`,
}

export const IMPL_TYPES = {
  MERKLE: 0,
  SIGN: 1,
  VESTING: 2,
} as const

export const ARC_EXPLORER = 'https://explorer.testnet.arc.io'
