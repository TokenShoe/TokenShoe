'use client'
/**
 * Sign-in state (SIWE). Call ensureSignedIn() before creator actions (uploading lists, editing lists, editing project details).
 *
 * - The session lives in an HttpOnly cookie set by the backend; this only caches which address is signed in
 * - Switching wallet accounts invalidates the session automatically (sign again with the new account)
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { getAddress } from 'viem'
import { api } from '@/lib/client/api'
import { appChain } from '@/config/chain'

interface AuthState {
  /** Currently signed-in address (lowercase); counts as signed in only when it matches the wallet address */
  session: string | null
  signedIn: boolean
  signingIn: boolean
  ensureSignedIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [session, setSession] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    api<{ address: string | null }>('/api/auth/me').then((r) => setSession(r.address)).catch(() => setSession(null))
  }, [])

  const signedIn = !!address && session === address.toLowerCase()

  const ensureSignedIn = useCallback(async () => {
    if (!address) throw new Error('Connect your wallet first.')
    if (session === address.toLowerCase()) return
    setSigningIn(true)
    try {
      const { nonce } = await api<{ nonce: string }>('/api/auth/nonce')
      const message = createSiweMessage({
        address: getAddress(address),
        chainId: appChain.id,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: '1',
        statement: 'Sign in to TokenShoe to manage your distribution projects.',
      })
      const signature = await signMessageAsync({ message })
      const r = await api<{ address: string }>('/api/auth/login', { json: { message, signature } })
      setSession(r.address)
    } finally {
      setSigningIn(false)
    }
  }, [address, session, signMessageAsync])

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ session, signedIn, signingIn, ensureSignedIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
