/**
 * Optional dependencies of wallet SDKs that we never use; both bundlers replace them with an empty module.
 *  - @coinbase/cdp-sdk: ConnectKit pulls in every wagmi connector; the Base Account connector depends on it,
 *    and it statically imports optional packages that aren't installed (@x402/*), which breaks the build.
 *  - @react-native-async-storage/async-storage: only used by MetaMask SDK on React Native
 *  - pino-pretty / lokijs / encoding: optional logging/storage deps of WalletConnect, not needed in the browser
 */
const STUBBED = ['@coinbase/cdp-sdk', '@react-native-async-storage/async-storage', 'pino-pretty', 'lokijs', 'encoding']

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets e2e runs use their own build dir (NEXT_DIST_DIR=.next-e2e) without disturbing a running `bun run dev`
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // pg is a native Node module; don't let Next bundle it
    serverComponentsExternalPackages: ['pg'],
    // Same stubs as the webpack config below, for the Turbopack dev server (`next dev --turbo`)
    turbo: {
      resolveAlias: Object.fromEntries(STUBBED.map((m) => [m, './src/lib/empty-module.js'])),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@coinbase/cdp-sdk': false,
      '@react-native-async-storage/async-storage': false,
    }
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    return config
  },
}

export default nextConfig
