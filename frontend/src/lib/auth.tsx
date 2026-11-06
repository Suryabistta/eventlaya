import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, tokenStore, AUTH_EXPIRED_EVENT, type AuthUser } from '@/services/api'

interface AuthContextValue {
  user: AuthUser | null
  status: 'loading' | 'authenticated' | 'anonymous'
  login: (email: string, password: string, remember?: boolean) => Promise<AuthUser>
  logout: () => void
  /** Re-fetch the signed-in user (e.g. after their marketplace access changes). */
  refresh: () => Promise<AuthUser | null>
  /** Sign in with tokens obtained elsewhere (Google/Facebook sign-in). */
  startSession: (res: { access: string; refresh: string; user: AuthUser }, remember?: boolean) => AuthUser
  /** Replace the cached user after a profile change. */
  updateUser: (u: AuthUser) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>(tokenStore.access ? 'loading' : 'anonymous')

  useEffect(() => {
    if (!tokenStore.access) return
    api
      .me()
      .then((u) => {
        setUser(u)
        setStatus('authenticated')
      })
      .catch(() => {
        tokenStore.clear()
        setStatus('anonymous')
      })
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout)
  }, [logout])

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const res = await api.login(email, password, remember)
    tokenStore.set(res.access, res.refresh, remember)
    setUser(res.user)
    setStatus('authenticated')
    return res.user
  }, [])

  const startSession = useCallback((res: { access: string; refresh: string; user: AuthUser }, remember = true) => {
    tokenStore.set(res.access, res.refresh, remember)
    setUser(res.user)
    setStatus('authenticated')
    return res.user
  }, [])

  const updateUser = useCallback((u: AuthUser) => setUser(u), [])

  const refresh = useCallback(async () => {
    if (!tokenStore.access) return null
    const u = await api.me()
    setUser(u)
    return u
  }, [])

  return <AuthContext.Provider value={{ user, status, login, logout, refresh, startSession, updateUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export const isSuperadmin = (user: AuthUser | null) => user?.role === 'superadmin'

/** Gate for /app and /admin routes. Optionally restrict to roles. */
export const RequireAuth: React.FC<{ roles?: AuthUser['role'][]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading your workspace">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      </div>
    )
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/app" replace />
  }
  return <>{children}</>
}
