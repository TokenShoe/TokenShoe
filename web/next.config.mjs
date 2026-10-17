/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets e2e runs use their own build dir (NEXT_DIST_DIR=.next-e2e) without disturbing a running `bun run dev`
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // pg is a native Node module; don't let Next bundle it
    serverComponentsExternalPackages: ['pg'],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // ConnectKit pulls in every wagmi connector; the Base Account connector depends on @coinbase/cdp-sdk,
      // which statically imports optional deps that aren't installed (@x402/*) and breaks the build. We don't use Base Account, so stub it out.
      '@coinbase/cdp-sdk': false,
      // Storage library MetaMask SDK only uses on React Native
      '@react-native-async-storage/async-storage': false,
    }
    // Optional logging libraries WalletConnect depends on; not needed in the browser
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    return config
  },
}

export default nextConfig
