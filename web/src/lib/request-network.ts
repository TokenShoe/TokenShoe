/**
 * Which network the current API request is for (server only).
 *
 * route() reads the network from the request (x-network header, or ?network=) and runs the handler inside
 * runWithNetwork(); anything below it - db(), publicClient(), contracts() - picks that network's resources.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { DEFAULT_NETWORK, isNetworkKey, NETWORKS, type NetworkKey } from '@/config/networks'

const storage = new AsyncLocalStorage<NetworkKey>()

export const NETWORK_HEADER = 'x-network'

/** Network requested by the client; defaults to testnet; null = unknown value */
export function networkFromRequest(req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } }): NetworkKey | null {
  const raw = req.headers.get(NETWORK_HEADER) ?? req.nextUrl?.searchParams.get('network') ?? DEFAULT_NETWORK
  return isNetworkKey(raw) ? raw : null
}

export function runWithNetwork<T>(key: NetworkKey, fn: () => T): T {
  return storage.run(key, fn)
}

/** The current request's network (testnet outside a request, e.g. scripts) */
export function currentNetworkKey(): NetworkKey {
  return storage.getStore() ?? DEFAULT_NETWORK
}

export const currentNetworkConfig = () => NETWORKS[currentNetworkKey()]
