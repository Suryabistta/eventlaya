import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Check, Eye, EyeOff, QrCode, ScanLine } from 'lucide-react'
import { Input, Logo } from '@/components/ui'
import { TenantMark, useTenant } from '@/lib/tenant'
import type { ResolvedTenant } from '@/services/api'
import { cn } from '@/lib/utils'
import { GatePassDemo } from '../LandingPage'

/* ------------------------------------------------------------------ */
/* Layout: form on the left, product on the right (lg+)                 */

export const FeatureList: React.FC<{ items: { icon: React.ElementType; text: string }[] }> = ({ items }) => (
  <ul className="mt-6 space-y-3 text-ink-700">
    {items.map((f) => (
      <li key={f.text} className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-2xs">
          <f.icon className="h-4 w-4" aria-hidden />
        </span>
        {f.text}
      </li>
    ))}
  </ul>
)

/** Default product panel: event tools. */
export const EventToolsAside: React.FC = () => (
  <>
    <h2 className="font-display text-[34px] font-bold leading-[1.1] text-ink-900">Registration to gate, on one screen.</h2>
    <FeatureList
      items={[
        { icon: QrCode, text: 'Every sign-up gets a QR pass instantly' },
        { icon: ScanLine, text: 'Any phone scans people in and out' },
        { icon: BarChart3, text: 'Live counts, crew tasks and budget in one place' },
      ]}
    />
    <div className="mt-10">
      <GatePassDemo />
    </div>
  </>
)

type AuthShellProps = {
  title: string
  subtitle: React.ReactNode
  children: React.ReactNode
  aside?: React.ReactNode
  /** Wider form column, e.g. for the sign-up stepper. */
  wide?: boolean
  /** Extra bottom padding on phones when a sticky action bar is shown. */
  stickyFooter?: boolean
}

/** Sign-in pages. On a white-label site: the organizer's brand, no Eventlaya marketing. */
export const AuthShell: React.FC<AuthShellProps> = (props) => {
  const tenant = useTenant()
  return tenant ? <TenantAuthShell tenant={tenant} {...props} /> : <PlatformAuthShell {...props} />
}

const TenantAuthShell: React.FC<AuthShellProps & { tenant: ResolvedTenant }> = ({ tenant, title, subtitle, children, wide }) => (
  <div className="flex min-h-screen flex-col bg-ink-50">
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${tenant.brand_name} home`}>
          <TenantMark tenant={tenant} />
        </Link>
      </div>
    </header>
    <main id="main" className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
      <div className={cn('w-full rounded-2xl border border-ink-200 bg-white p-6 sm:p-8', wide ? 'max-w-[520px]' : 'max-w-[440px]')}>
        <h1 className="font-display text-[28px] font-bold leading-tight text-ink-900">{title}</h1>
        <p className="mt-2 text-ink-600">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  </div>
)

const PlatformAuthShell: React.FC<AuthShellProps> = ({ title, subtitle, children, aside, wide, stickyFooter }) => (
  <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <div className={cn('flex min-h-screen flex-col px-5 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-10 lg:px-16', stickyFooter && 'pb-32 sm:pb-10')}>
      <header className="flex items-center justify-between">
        <Link to="/" aria-label="Eventlaya home">
          <Logo />
        </Link>
        <Link to="/events" className="text-sm font-medium text-ink-600 hover:text-ink-900">
          Browse events
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-center py-10">
        <div className={cn('mx-auto w-full', wide ? 'max-w-[480px]' : 'max-w-[400px]')}>
          <h1 className="font-display text-[32px] font-bold leading-tight text-ink-900">{title}</h1>
          <p className="mt-2 text-ink-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
      <p className="text-center text-xs text-ink-500 lg:text-left">© {new Date().getFullYear()} Eventlaya. Dharan, Itahari and Biratnagar.</p>
    </div>

    <aside className="relative hidden overflow-hidden border-l border-ink-200 bg-ink-100 lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20" aria-label="About Eventlaya">
      <div className="mx-auto w-full max-w-lg">{aside ?? <EventToolsAside />}</div>
    </aside>
  </div>
)

export const PasswordInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }
> = ({ label, hint, error, ...props }) => {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input label={label} hint={hint} error={error} type={visible ? 'text' : 'password'} className="h-11 pr-11" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-[30px] inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

export function passwordChecks(pw: string) {
  return [
    { label: 'At least 8 characters', ok: pw.length >= 8 },
    { label: 'A number', ok: /\d/.test(pw) },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  ]
}

/** Three-segment meter plus the checklist under a new-password field. */
export const PasswordStrength: React.FC<{ password: string }> = ({ password }) => {
  if (!password) return null
  const checks = passwordChecks(password)
  const strength = checks.filter((c) => c.ok).length
  return (
    <div className="mt-3">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i < strength ? (strength === 3 ? 'bg-emerald-500' : strength === 2 ? 'bg-marigold-500' : 'bg-red-500') : 'bg-ink-200',
            )}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {checks.map((c) => (
          <li key={c.label} className={cn('flex items-center gap-1.5 text-xs', c.ok ? 'text-emerald-700' : 'text-ink-500')}>
            <Check className={cn('h-3.5 w-3.5', c.ok ? 'opacity-100' : 'opacity-30')} aria-hidden />
            {c.label}
            <span className="sr-only">{c.ok ? '(done)' : '(not yet)'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
