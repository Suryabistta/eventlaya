/**
 * White-label site: what visitors see on event.dharanfilmfestival.org or dff.eventlaya.com.
 *
 * Only the attendee side of Eventlaya, under the organizer's brand: their events, event pages, registration,
 * passes and "My tickets". Organizer tools, pricing, marketplace and sign-up live on eventlaya.com.
 * The API scopes every public call to this organizer (X-Tenant-Host, see services/api.ts).
 */
import React, { useLayoutEffect } from 'react'
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, CalendarDays, CalendarX2, LogOut, Mail, Radio, Ticket } from 'lucide-react'
import { api, type Event, type ResolvedTenant } from '@/services/api'
import { RequireAuth, useAuth } from '@/lib/auth'
import { TENANT_HOST, TENANT_OVERRIDE, platformUrl } from '@/lib/tenant-host'
import { TenantMark, TenantProvider, applyTenantTheme, useTenant } from '@/lib/tenant'
import { eventPhase } from '@/lib/phase'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { EventCard } from '@/pages/ExploreEventsPage'
import { bottomBarPadding } from '@/components/LegalFooter'
import { LEGAL_PATHS, legalHref } from '@/lib/legal'

function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })))
}

const PublicEventPage = lazyPage(() => import('@/pages/PublicEventPage'), 'PublicEventPage')
const EventRegisterPage = lazyPage(() => import('@/pages/EventRegisterPage'), 'EventRegisterPage')
const PublicPassPage = lazyPage(() => import('@/pages/PublicPassPage'), 'PublicPassPage')
const PublicVotePage = lazyPage(() => import('@/pages/voting/PublicVotePage'), 'PublicVotePage')
const MyTicketsPage = lazyPage(() => import('@/pages/account/MyTicketsPage'), 'MyTicketsPage')
const VerifyEmailPage = lazyPage(() => import('@/pages/account/VerifyEmailPage'), 'VerifyEmailPage')
const LoginPage = lazyPage(() => import('@/pages/AuthPages'), 'LoginPage')
const ForgotPasswordPage = lazyPage(() => import('@/pages/auth/PasswordResetPages'), 'ForgotPasswordPage')
const ResetPasswordPage = lazyPage(() => import('@/pages/auth/PasswordResetPages'), 'ResetPasswordPage')

const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label={label}>
    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
  </div>
)

export const TenantApp: React.FC = () => {
  const host = TENANT_HOST!
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tenant', host],
    queryFn: () => api.resolveTenant(host),
    staleTime: 5 * 60_000,
    retry: 2,
  })
  const live = data?.is_whitelabel && data.state === 'live' ? data : null

  useLayoutEffect(() => {
    if (live) applyTenantTheme(live)
  }, [live])

  if (isLoading) return <Spinner label="Loading the site" />
  if (!live) return <SiteNotReady host={host} state={isError ? 'error' : data?.state === 'unavailable' ? 'unavailable' : 'not_set_up'} />

  return (
    <TenantProvider tenant={live}>
      <Routes>
        <Route element={<TenantLayout />}>
          <Route path="/" element={<TenantHome />} />
          <Route path="/events" element={<Navigate to="/" replace />} />
          <Route path="/e/:slug" element={<PublicEventPage />} />
          <Route path="/e/:slug/register" element={<EventRegisterPage />} />
          <Route path="/e/:slug/vote" element={<PublicVotePage />} />
          <Route path="/e/:slug/vote/:pollId" element={<PublicVotePage />} />
          <Route path="/e/:slug/vote/:pollId/c/:cref" element={<PublicVotePage />} />
          <Route path="/ticket/:token" element={<PublicPassPage />} />
          <Route path="/my/tickets" element={<RequireAuth><MyTicketsPage /></RequireAuth>} />
          {/* Links shared with eventlaya.com (registration success, pass page) */}
          <Route path="/app/my/tickets" element={<Navigate to="/my/tickets" replace />} />
          <Route path="/app" element={<Navigate to="/my/tickets" replace />} />
          <Route path="/app/*" element={<OnEventlaya kind="organizer" />} />
          <Route path="/admin/*" element={<OnEventlaya kind="organizer" />} />
          <Route path="/signup" element={<OnEventlaya kind="signup" />} />
          <Route path="/pricing" element={<OnEventlaya kind="organizer" />} />
          <Route path="/marketplace/*" element={<OnEventlaya kind="organizer" />} />
          <Route path="*" element={<TenantNotFound />} />
        </Route>
        <Route path="/login" element={<Suspended><LoginPage /></Suspended>} />
        <Route path="/forgot-password" element={<Suspended><ForgotPasswordPage /></Suspended>} />
        <Route path="/reset-password" element={<Suspended><ResetPasswordPage /></Suspended>} />
        <Route path="/verify-email" element={<Suspended><RequireAuth><VerifyEmailPage /></RequireAuth></Suspended>} />
      </Routes>
    </TenantProvider>
  )
}

export default TenantApp

const Suspended: React.FC<{ children: React.ReactNode }> = ({ children }) => <React.Suspense fallback={<Spinner />}>{children}</React.Suspense>

/* ------------------------------------------------------------------ */
/* Layout                                                               */

const TenantLayout: React.FC = () => {
  const tenant = useTenant()!
  const { user, status, logout } = useAuth()
  const location = useLocation()
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors sm:px-3', isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900')

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <div className="h-1 bg-brand-600" style={{ backgroundColor: 'rgb(var(--tenant-accent, var(--brand-600)))' }} aria-hidden />
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="mr-auto min-w-0" aria-label={`${tenant.brand_name} home`}>
            <TenantMark tenant={tenant} />
          </Link>
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Events
            </NavLink>
            {status === 'authenticated' ? (
              <>
                <NavLink to="/my/tickets" className={navClass}>
                  <span className="hidden sm:inline">My tickets</span>
                  <Ticket className="h-5 w-5 sm:hidden" aria-label="My tickets" />
                </NavLink>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                  aria-label={`Sign out ${user?.email ?? ''}`}
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                </button>
              </>
            ) : (
              <Link to="/login" state={{ from: location.pathname === '/' ? '/my/tickets' : location.pathname }} className={navClass({ isActive: false })}>
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <React.Suspense fallback={<Spinner />}>
          <Outlet />
        </React.Suspense>
      </main>

      <TenantFooter tenant={tenant} />
    </div>
  )
}

const TenantFooter: React.FC<{ tenant: ResolvedTenant }> = ({ tenant }) => {
  const { pathname } = useLocation()
  return (
    <footer className={cn('border-t border-ink-200 bg-white', bottomBarPadding(pathname))}>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-1">
          <p className="font-semibold text-ink-900">{tenant.brand_name}</p>
          {tenant.footer_text && <p>{tenant.footer_text}</p>}
          {tenant.support_email && (
            <a href={`mailto:${tenant.support_email}`} className="inline-flex items-center gap-1.5 hover:text-brand-700 hover:underline">
              <Mail className="h-4 w-4" aria-hidden />
              {tenant.support_email}
            </a>
          )}
        </div>
        {!tenant.remove_watermark && (
          <a href={platformUrl('/')} className="inline-flex items-center gap-2 text-xs text-ink-500 hover:text-ink-800">
            Powered by
            <img src="/brand/logo.png" alt="Eventlaya" className="h-5 w-auto" />
          </a>
        )}
      </div>
      {/* The site runs on Eventlaya, so Eventlaya's policies apply (they open on eventlaya.com) */}
      <div className="border-t border-ink-100">
        <nav aria-label="Legal" className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-xs text-ink-500 sm:px-6">
          <span>Registration and passes by Eventlaya</span>
          {(
            [
              ['Privacy', LEGAL_PATHS.privacy],
              ['Terms', LEGAL_PATHS.terms],
              ['Community guidelines', LEGAL_PATHS.community],
              ['Delete account', LEGAL_PATHS.deleteAccount],
            ] as const
          ).map(([label, path]) => (
            <a key={path} href={legalHref(path)} className="hover:text-ink-800 hover:underline">
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ */
/* Home: their events                                                   */

type PublicEvent = Event & { organizer_name?: string }

const TenantHome: React.FC = () => {
  const tenant = useTenant()!
  const upcomingQ = useQuery({ queryKey: ['public-events', 'tenant', 'upcoming'], queryFn: () => api.getPublicEvents({ when: 'upcoming' }) })
  const pastQ = useQuery({ queryKey: ['public-events', 'tenant', 'past'], queryFn: () => api.getPublicEvents({ when: 'past' }) })

  const upcoming = (upcomingQ.data ?? []) as PublicEvent[]
  const live = upcoming.filter((e) => eventPhase(e) === 'live')
  const next = upcoming.filter((e) => eventPhase(e) !== 'live')
  const past = (pastQ.data ?? []) as PublicEvent[]
  const name = tenant.brand_name || tenant.organizer_name || 'Our events'

  return (
    <div>
      <section className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:px-6 sm:py-14">
          <TenantMark tenant={tenant} large />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-ink-900 sm:text-5xl">{name}</h1>
            <p className="mt-2 max-w-2xl text-lg text-ink-600">
              {live.length > 0
                ? `${live.length === 1 ? 'An event is' : `${live.length} events are`} happening now.`
                : next.length > 0
                  ? 'Register for an upcoming event and get your pass straight away.'
                  : 'See what’s coming up and catch up on past events.'}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-4 pb-20 pt-10 sm:px-6">
        {upcomingQ.isError ? (
          <ErrorState message={(upcomingQ.error as Error)?.message} onRetry={() => void upcomingQ.refetch()} />
        ) : upcomingQ.isLoading ? (
          <CardGrid>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[23rem] rounded-2xl" />
            ))}
          </CardGrid>
        ) : (
          <>
            {live.length > 0 && (
              <EventSection title="Happening now" icon={<Radio className="h-5 w-5 text-emerald-600" aria-hidden />} events={live} />
            )}
            {next.length > 0 ? (
              <EventSection title="Upcoming events" icon={<CalendarDays className="h-5 w-5 text-brand-600" aria-hidden />} events={next} />
            ) : (
              live.length === 0 && (
                <div className="rounded-2xl border border-ink-200 bg-white">
                  <EmptyState
                    icon={<CalendarX2 className="h-6 w-6" />}
                    title="No upcoming events right now"
                    description={`New events from ${name} will show up here.`}
                  />
                </div>
              )
            )}
          </>
        )}

        {past.length > 0 && <EventSection title="Past events" events={past} past />}
      </div>
    </div>
  )
}

const CardGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
)

const EventSection: React.FC<{ title: string; icon?: React.ReactNode; events: PublicEvent[]; past?: boolean }> = ({ title, icon, events, past }) => (
  <section aria-label={title}>
    <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold text-ink-900">
      {icon}
      {title}
      <span className="text-base font-medium text-ink-400">{events.length}</span>
    </h2>
    <CardGrid>
      {events.map((e) => (
        <EventCard key={e.id} event={{ ...e, organizer_name: undefined }} past={!!past} />
      ))}
    </CardGrid>
  </section>
)

/* ------------------------------------------------------------------ */
/* Edges                                                                */

const OnEventlaya: React.FC<{ kind: 'organizer' | 'signup' }> = ({ kind }) => {
  const location = useLocation()
  const target = kind === 'signup' ? '/signup' : location.pathname + location.search
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold text-ink-900">
          {kind === 'signup' ? 'Create your account on Eventlaya' : 'Organizer tools are on Eventlaya'}
        </h1>
        <p className="mt-2 text-ink-600">
          {kind === 'signup'
            ? 'Accounts are shared across Eventlaya. You don’t need one to register for an event: your pass is emailed to you.'
            : 'Managing events, gates, team and branding happens in your Eventlaya dashboard. Sign in there with the same account.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={platformUrl(target)}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {kind === 'signup' ? 'Continue to Eventlaya' : 'Open the Eventlaya dashboard'}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
          <Link to="/" className="inline-flex h-10 items-center rounded-[10px] border border-ink-200 px-4 text-sm font-semibold text-ink-800 hover:bg-ink-50">
            Back to events
          </Link>
        </div>
      </div>
    </div>
  )
}

const TenantNotFound: React.FC = () => (
  <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
    <h1 className="font-display text-3xl font-bold text-ink-900">This page doesn’t exist</h1>
    <p className="mt-2 text-ink-600">The link may be old, or the event may have been unpublished.</p>
    <Link to="/" className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
      See all events
    </Link>
  </div>
)

/** Unknown, unverified, revoked or switched-off host. Neutral (no brand), never Eventlaya marketing. */
const SiteNotReady: React.FC<{ host: string; state: 'not_set_up' | 'unavailable' | 'error' }> = ({ host, state }) => {
  // Pass and event links from emails keep working on eventlaya.com
  const path = window.location.pathname
  const passPath = /^\/(ticket|e)\//.test(path) ? path : null
  useLayoutEffect(() => {
    document.title = state === 'error' ? 'Can’t load this site' : 'Site not available'
  }, [state])
  const copy = {
    not_set_up: {
      title: 'This site isn’t set up yet',
      body: 'The address works, but there’s no event site connected to it yet. If you run this site, finish connecting your domain in Eventlaya under Branding and domain. DNS changes can take up to an hour.',
    },
    unavailable: {
      title: 'This site isn’t available right now',
      body: 'This organization’s event site is switched off at the moment. Passes and event pages are still on eventlaya.com.',
    },
    error: {
      title: 'We can’t load this site right now',
      body: 'Check your connection and try again in a moment.',
    },
  }[state]
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-6 text-center sm:p-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500" aria-hidden>
          <CalendarX2 className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-ink-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-1 break-all font-mono text-sm text-ink-500">{host}</p>
        <p className="mt-4 text-ink-600">{copy.body}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {state === 'error' ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center rounded-[10px] bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800"
            >
              Try again
            </button>
          ) : passPath ? (
            <a href={platformUrl(passPath)} className="inline-flex h-10 items-center rounded-[10px] bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800">
              Open this page on Eventlaya
            </a>
          ) : (
            <a href={platformUrl('/app/branding')} className="inline-flex h-10 items-center rounded-[10px] bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800">
              I run this site
            </a>
          )}
          <a href={platformUrl('/events')} className="inline-flex h-10 items-center rounded-[10px] border border-ink-200 px-4 text-sm font-semibold text-ink-800 hover:bg-ink-50">
            Browse events on Eventlaya
          </a>
        </div>
        {TENANT_OVERRIDE && (
          <p className="mt-6 text-xs text-ink-400">
            Developer preview of {host}.{' '}
            <a className="underline" href="?tenant=off">
              Leave preview
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
