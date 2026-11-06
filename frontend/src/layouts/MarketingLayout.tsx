import React, { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarDays, House, LayoutDashboard, LogIn, Menu, Store, Ticket, UserRound, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { Logo } from '@/components/ui/Logo'
import { buttonClass } from '@/components/ui/Button'
import { LEGAL_PATHS } from '@/lib/legal'
import { useBlogEnabled } from '@/lib/seo'

const links = [
  { label: 'Features', to: '/#features' },
  { label: 'Events', to: '/events' },
  { label: 'Vendors & venues', to: '/marketplace' },
  { label: 'Pricing', to: '/pricing' },
]

export const MarketingLayout: React.FC = () => {
  const { status } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.hash])

  // Support /#section links across route changes
  useEffect(() => {
    if (!location.hash) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [location.pathname, location.hash])

  const signedIn = status === 'authenticated'
  // Blog link only in the footer and the phone menu (module `blog`; hidden when the superadmin switches it off)
  const blog = useBlogEnabled()

  return (
    // Bottom padding keeps the footer clear of the phone tab bar
    <div className="flex min-h-screen flex-col bg-white pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-pop"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link to="/" aria-label="Eventlaya home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive && !l.to.includes('#') ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {signedIn ? (
              <Link to="/app" className={buttonClass('dark', 'md')}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className={buttonClass('ghost', 'md')}>
                  Sign in
                </Link>
                <Link to="/signup" className={buttonClass('primary', 'md')}>
                  Start free
                </Link>
              </>
            )}
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="animate-fade-in border-t border-ink-100 bg-white px-4 pb-5 pt-2 md:hidden">
            <nav className="flex flex-col" aria-label="Mobile">
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="rounded-lg px-2 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
                  {l.label}
                </Link>
              ))}
              {blog && (
                <Link to="/blog" className="rounded-lg px-2 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
                  Blog
                </Link>
              )}
            </nav>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {signedIn ? (
                <Link to="/app" className={buttonClass('dark', 'lg', 'col-span-2')}>
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className={buttonClass('secondary', 'lg')}>
                    Sign in
                  </Link>
                  <Link to="/signup" className={buttonClass('primary', 'lg')}>
                    Start free
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <React.Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
              <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
            </div>
          }
        >
          <Outlet />
        </React.Suspense>
      </main>

      <footer className="border-t border-ink-200 bg-ink-50 text-ink-600">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-4 py-14 sm:px-6 md:grid-cols-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 max-w-xs md:col-span-4 lg:col-span-1">
            <Logo tagline />
            <p className="mt-4 text-sm leading-relaxed text-ink-600">
              Registration, QR passes and gate check-in for clubs, colleges and venues. Built in Dharan for Eastern Nepal.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ['Features', '/#features'],
              ['Pricing', '/pricing'],
              ['Upcoming events', '/events'],
              ...(blog ? ([['Blog', '/blog']] as [string, string][]) : []),
            ]}
          />
          <FooterCol
            title="Marketplace"
            links={[
              ['Find vendors', '/marketplace'],
              ['List your venue', '/signup?type=vendor'],
            ]}
          />
          <FooterCol
            title="Account"
            links={[
              ['Sign in', '/login'],
              ['Create an account', '/signup'],
              ['Delete account', LEGAL_PATHS.deleteAccount],
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              ['Privacy policy', LEGAL_PATHS.privacy],
              ['Terms of service', LEGAL_PATHS.terms],
              ['Community guidelines', LEGAL_PATHS.community],
              ['Contact', LEGAL_PATHS.contact],
              ['Analytics preferences', `${LEGAL_PATHS.privacy}#analytics`],
            ]}
          />
        </div>
        <div className="border-t border-ink-200">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-500 sm:px-6">
            © {new Date().getFullYear()} Eventlaya. Dharan, Itahari and Biratnagar.
          </p>
        </div>
      </footer>

      <PublicTabBar />
    </div>
  )
}

type Tab = { label: string; to: string; icon: LucideIcon; end?: boolean }

/** Phones: app-style tab bar with icons, same look as the dashboard's. */
const PublicTabBar: React.FC = () => {
  const { status, user } = useAuth()
  const signedIn = status === 'authenticated'
  const tabs: Tab[] = [
    { label: 'Home', to: '/', icon: House, end: true },
    { label: 'Events', to: '/events', icon: CalendarDays },
    { label: 'Vendors', to: '/marketplace', icon: Store },
    // Guests are sent to sign in and come back here
    { label: 'Tickets', to: '/app/my/tickets', icon: Ticket },
    !signedIn
      ? { label: 'Sign in', to: '/login', icon: LogIn }
      : user?.role === 'attendee'
        ? { label: 'Account', to: '/app/profile', icon: UserRound }
        : { label: 'Dashboard', to: '/app', icon: LayoutDashboard },
  ]

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200/70 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <ul className="mx-auto flex h-[60px] max-w-xl items-stretch">
        {tabs.map((t) => (
          <li key={t.label} className="flex-1">
            <NavLink to={t.to} end={t.end} className="group flex h-full flex-col items-center justify-center gap-1">
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200',
                      isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-500 group-active:bg-ink-100',
                    )}
                  >
                    <t.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
                  </span>
                  <span className={cn('text-[11px] leading-none', isActive ? 'font-semibold text-brand-700' : 'font-medium text-ink-500')}>
                    {t.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const FooterCol: React.FC<{ title: string; links: [string, string][] }> = ({ title, links }) => (
  <div>
    <p className="text-sm font-semibold text-ink-900">{title}</p>
    <ul className="mt-3 space-y-2">
      {links.map(([label, to]) => (
        <li key={label}>
          <Link to={to} className="text-sm text-ink-600 transition-colors hover:text-brand-700">
            {label}
          </Link>
        </li>
      ))}
    </ul>
  </div>
)
