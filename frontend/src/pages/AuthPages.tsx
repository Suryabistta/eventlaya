import React, { useState } from 'react'
import { track } from '@/lib/analytics'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useTenant } from '@/lib/tenant'
import { Button, Input, useToast } from '@/components/ui'
import { AuthShell, PasswordInput } from './auth/shared'
import { SocialSignIn } from '@/components/SocialSignIn'
import type { SocialLoginResponse } from '@/lib/social'

/* ------------------------------------------------------------------ */

const demoAccounts = [
  { label: 'Organizer', email: 'organizer@eventlaya.com' },
  { label: 'Gate staff', email: 'staff@eventlaya.com' },
  { label: 'Vendor', email: 'vendor@eventlaya.com' },
  { label: 'Platform admin', email: 'superadmin@eventlaya.com' },
]

export const LoginPage: React.FC = () => {
  const { login, status, startSession } = useAuth()
  const tenant = useTenant()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from || '/app'
  const [params] = useSearchParams()

  const [email, setEmail] = useState(() => params.get('email') ?? '')
  const [remember, setRemember] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to={from} replace />

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string; remember: boolean }) => {
    e?.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const user = await login(creds?.email ?? email, creds?.password ?? password, creds?.remember ?? remember)
      track('login', { method: 'email' })
      toast.success(`Signed in as ${user.organization_name || user.email}`)
      navigate(user.role === 'staff' && from === '/app' ? '/app/scanner' : from, { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      const friendly = /credentials|active account/i.test(msg) ? 'That email and password don’t match an account.' : msg
      setError(friendly)
      toast.error('Couldn’t sign in', friendly)
    } finally {
      setSubmitting(false)
    }
  }

  const socialDone = (res: SocialLoginResponse) => {
    const user = startSession(res, remember)
    track(res.created ? 'sign_up' : 'login', { method: res.provider })
    setError('')
    toast.success(
      res.created ? 'Account created' : `Signed in as ${user.email}`,
      res.linked_tickets ? `${res.linked_tickets} pass${res.linked_tickets === 1 ? '' : 'es'} linked to your account.` : undefined,
    )
    navigate(from, { replace: true })
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        tenant ? (
          'Sign in to see your tickets. You don’t need an account to register: your pass is emailed to you.'
        ) : (
          <>
            New to Eventlaya?{' '}
            <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
              Create an account
            </Link>
          </>
        )
      }
    >
      <SocialSignIn
        mode="signin"
        remember={remember}
        onSuccess={socialDone}
        onError={(msg) => {
          setError(msg)
          toast.error('Couldn’t sign in', msg)
        }}
      />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <Link
              to={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
              className="rounded-md text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Forgot password?
            </Link>
          </div>
        </div>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-600" />
          <span>
            <span className="block text-sm font-medium text-ink-800">Keep me signed in on this device</span>
            <span className="block text-xs text-ink-500">Untick on shared computers</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={!email || !password}>
          Sign in
        </Button>
      </form>

      {import.meta.env.DEV && (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-200 p-4">
          <p className="text-sm font-medium text-ink-700">Try a demo account</p>
          <p className="text-xs text-ink-500">Development builds only</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {demoAccounts.map((a) => (
              <Button
                key={a.email}
                variant="secondary"
                size="sm"
                className="px-2"
                disabled={submitting}
                onClick={() => submit(undefined, { email: a.email, password: 'password123', remember: true })}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  )
}

export { SignupPage } from './auth/SignupPage'
