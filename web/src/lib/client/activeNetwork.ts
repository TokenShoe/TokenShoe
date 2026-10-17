/**
 * The network selected in the nav (browser side).
 *
 * A plain module variable rather than React state so non-React code (api(), error messages) can read it.
 * <NetworkProvider/> keeps it in sync and remounts the page tree when it changes, so components always
 * render with the current value. The choice is remembered in localStorage; `?network=mainnet` in the URL wins.
 */
import { DEFAULT_NETWORK, isNetworkKey, NETWORKS, type NetworkKey } from '@/config/networks'

const STORAGE_KEY = 'tokenshoe.network'

let active: NetworkKey = DEFAULT_NETWORK

export const getActiveNetwork = (): NetworkKey => active
export const activeNetworkConfig = () => NETWORKS[active]

/** Set the network used by api() (called while rendering, so it must not touch storage) */
export function syncActiveNetwork(key: NetworkKey) {
  active = key
}

/** Remember the user's choice for next time */
export function saveNetworkChoice(key: NetworkKey) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Storage blocked (private mode etc.): the choice just won't be remembered
  }
}

/** Network to start with in this browser: ?network= in the URL, then the saved choice, then the default */
export function initialNetwork(): NetworkKey {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('network')
    if (isNetworkKey(fromUrl)) return fromUrl
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isNetworkKey(saved)) return saved
  } catch {
    // ignore
  }
  return DEFAULT_NETWORK
}
