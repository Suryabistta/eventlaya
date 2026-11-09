import React, { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CalendarDays,
  FileText,
  ScanLine,
  Vote,
  BarChart3,
  Store,
  Palette,
  CreditCard,
  ShieldCheck,
  LayoutGrid,
  ChevronRight,
  X,
  ChevronsLeft,
  ChevronDown,
  ExternalLink,
  LogOut,
  Check,
  ListChecks,
  Building2,
  Inbox,
  Gauge,
  SlidersHorizontal,
  Activity,
  Newspaper,
  DoorOpen,
  PieChart,
  UsersRound,
  Ticket,
  MessageCircle,
  Star,
  UserRound,
  MailWarning,
  Wallet,
  LineChart,
  Receipt,
  MapPin,
  GalleryHorizontal,
  Image as ImageIcon,
  Printer,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { api, request } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { CurrentEventProvider, useCurrentEvent } from '@/lib/event-context'
import { Logo, LogoMark } from '@/components/ui/Logo'
import { PhaseBadge } from '@/components/PhaseBadge'
import { eventPhase, phaseMeta, sortByPhase } from '@/lib/phase'
import type { AuthUser } from '@/services/api'
import { useModules } from '@/lib/modules'
import { ChatProvider, useChat } from '@/lib/chat/socket'
import { mediaUrl, personName } from '@/lib/account'

type Role = AuthUser['role']

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  end?: boolean
  roles?: Role[]
  badge?: number
  /** Sub-items shown indented under the parent (sidebar and More sheet). */
  children?: NavItem[]
}

const ORGANIZER: Role[] = ['organizer', 'superadmin']
const TEAM_CHAT: Role[] = ['organizer', 'staff']

/** Feature switches and live counts the navigation depends on. */
interface NavExtras {
  chat: boolean
  chatUnread: number
  reviews: boolean
  marketplace: boolean
  whiteLabel: boolean
  payments: boolean
  printedTickets: boolean
}
const noExtras: NavExtras = { chat: false, chatUnread: 0, reviews: false, marketplace: true, whiteLabel: true, payments: true, printedTickets: false }

/** Modules on for this user + chat unread count, for the sidebar, More sheet and tab bar. */
function useNavExtras(): NavExtras {
  const modules = useModules()
  const chat = useChat()
  return {
    chat: chat.available,
    chatUnread: chat.unread,
    reviews: modules.enabled('reviews'),
    printedTickets: modules.enabled('offline_tickets'),
    marketplace: modules.enabled('marketplace'),
    whiteLabel: modules.enabled('white_label'),
    payments: modules.enabled('payments'),
  }
}

const displayName = (u: AuthUser) => (u.role === 'attendee' ? personName(u) : u.organization_name || personName(u))

type NavGroup = { label: string; items: NavItem[] }

type ShellUser = AuthUser & { marketplace_access?: 'none' | 'pending' | 'approved' | 'rejected' }

const isVendor = (u: ShellUser | null) => u?.role === 'vendor'
const hasBusinessPortal = (u: ShellUser | null) => isVendor(u) || u?.marketplace_access === 'approved'

const eventTools = (x: NavExtras): NavGroup => ({
  label: 'Run your event',
  items: [
    { label: 'Overview', to: '/app', icon: LayoutDashboard, end: true },
    { label: 'Events', to: '/app/events', icon: CalendarDays, roles: ORGANIZER },
    { label: 'Tickets', to: '/app/tickets', icon: Ticket, roles: ORGANIZER },
    ...(x.printedTickets ? [{ label: 'Printed tickets', to: '/app/printed-tickets', icon: Printer, roles: ORGANIZER }] : []),
    { label: 'Payments', to: '/app/payments', icon: Wallet, roles: ORGANIZER },
    { label: 'Registration forms', to: '/app/forms', icon: FileText, roles: ORGANIZER },
    { label: 'Gate scanner', to: '/app/scanner', icon: ScanLine },
    { label: 'Gates & staff', to: '/app/gates', icon: DoorOpen, roles: ORGANIZER },
    { label: 'Team', to: '/app/team', icon: UsersRound, roles: ORGANIZER },
    { label: 'Live voting', to: '/app/voting', icon: Vote, roles: ORGANIZER },
    { label: 'Tasks', to: '/app/tasks', icon: ListChecks, roles: ORGANIZER },
    { label: 'Analytics', to: '/app/analytics', icon: BarChart3, roles: ORGANIZER },
    ...(x.chat ? [{ label: 'Messages', to: '/app/messages', icon: MessageCircle, roles: TEAM_CHAT, badge: x.chatUnread }] : []),
    ...(x.reviews ? [{ label: 'Reviews', to: '/app/reviews', icon: Star, roles: ORGANIZER }] : []),
  ],
})

/** Navigation depends on what the account is: event company, vendor, both, gate staff or platform admin. */
function buildNav(user: ShellUser | null, pending: PendingApprovals = noPending, x: NavExtras = noExtras): NavGroup[] {
  if (!user) return []

  const account: NavGroup = {
    label: 'Account',
    items: [{ label: 'Profile', to: '/app/profile', icon: UserRound }],
  }

  if (user.role === 'attendee') {
    return [
      {
        label: 'Your events',
        items: [
          { label: 'My tickets', to: '/app/my/tickets', icon: Ticket },
          ...(x.marketplace ? [{ label: 'My inquiries', to: '/app/my/inquiries', icon: Inbox }] : []),
          ...(x.payments ? [{ label: 'My payments', to: '/app/my/payments', icon: Receipt }] : []),
          ...(x.reviews ? [{ label: 'My reviews', to: '/app/my/reviews', icon: Star }] : []),
        ],
      },
      account,
    ]
  }

  const business: NavGroup = {
    label: 'Marketplace business',
    items: [
      { label: isVendor(user) ? 'Overview' : 'Business home', to: '/app/business', icon: Store, end: !isVendor(user) },
      { label: 'Listings', to: '/app/listings', icon: Building2 },
      { label: 'Inquiries', to: '/app/inquiries', icon: Inbox },
      ...(x.marketplace ? [{ label: 'Availability', to: '/app/availability', icon: CalendarDays }] : []),
      ...(isVendor(user) && x.reviews ? [{ label: 'Reviews', to: '/app/reviews', icon: Star }] : []),
    ],
  }

  if (isVendor(user)) {
    return [business, { label: 'Account', items: [{ label: 'Plan & billing', to: '/app/billing', icon: CreditCard }, ...account.items] }]
  }

  const workspace: NavGroup = {
    label: 'Workspace',
    items: [
      ...(x.whiteLabel ? [{ label: 'Branding & domain', to: '/app/branding', icon: Palette, roles: ORGANIZER }] : []),
      { label: 'Plan & billing', to: '/app/billing', icon: CreditCard, roles: ORGANIZER },
      ...(user.role === 'organizer' && !hasBusinessPortal(user)
        ? [{ label: 'List your business', to: '/app/marketplace-access', icon: Store }]
        : []),
      ...(user.role === 'organizer' ? [{ label: 'My tickets', to: '/app/my/tickets', icon: Ticket }] : []),
      ...(user.role === 'organizer' && x.payments ? [{ label: 'My payments', to: '/app/my/payments', icon: Receipt }] : []),
      ...account.items,
    ],
  }

  if (user.role === 'superadmin') {
    return [
      {
        label: 'Platform',
        items: [
          { label: 'Overview', to: '/admin', icon: Gauge, end: true },
          { label: 'Organizations', to: '/admin/organizations', icon: Building2 },
          {
            label: 'Approvals',
            to: '/admin/approvals',
            end: true,
            icon: ShieldCheck,
            badge: pending.total,
            children: [
              { label: 'White-label', to: '/admin/approvals/white-label', icon: Palette, badge: pending.whiteLabel },
              { label: 'Marketplace access', to: '/admin/approvals/marketplace', icon: Store, badge: pending.marketplace },
              { label: 'Listings', to: '/admin/approvals/listings', icon: Building2, badge: pending.listings },
            ],
          },
          { label: 'Billing & recharges', to: '/admin/billing', icon: CreditCard },
          ...(x.payments ? [{ label: 'Online payments', to: '/admin/payments', icon: Wallet }] : []),
          { label: 'Segments', to: '/admin/segments', icon: PieChart },
          { label: 'Modules & permissions', to: '/admin/modules', icon: SlidersHorizontal },
          { label: 'Cities & categories', to: '/admin/catalog', icon: MapPin },
          { label: 'Featured events', to: '/admin/featured-events', icon: Star },
          { label: 'Banners', to: '/admin/banners', icon: GalleryHorizontal },
          { label: 'Site logo', to: '/admin/site-logo', icon: ImageIcon },
          { label: 'Activity', to: '/admin/activity', icon: Activity },
          { label: 'Blog', to: '/admin/blog', icon: Newspaper },
          { label: 'Analytics', to: '/admin/analytics', icon: LineChart },
        ],
      },
      { ...eventTools(x), label: 'Event tools' },
      account,
    ]
  }

  return [eventTools(x), ...(hasBusinessPortal(user) ? [business] : []), workspace]
}

/** Pending approvals for the platform admin's badge. Tolerates the endpoint not existing yet. */
function usePendingApprovals(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => request<{ pending?: Record<string, number> }>('/platform/stats/'),
    enabled,
    refetchInterval: 60000,
    retry: false,
  })
  const p = data?.pending ?? {}
  const n = (k: string) => Number(p[k]) || 0
  return {
    total: n('white_label') + n('marketplace_access') + n('listings'),
    whiteLabel: n('white_label'),
    marketplace: n('marketplace_access'),
    listings: n('listings'),
  }
}

type PendingApprovals = ReturnType<typeof usePendingApprovals>
const noPending: PendingApprovals = { total: 0, whiteLabel: 0, marketplace: 0, listings: 0 }

/** A sub-item is active on its own page and anything below it. */
const subItemActive = (item: NavItem, pathname: string) => pathname === item.to || pathname.startsWith(`${item.to}/`)

const COLLAPSE_KEY = 'eventlaya:sidebar-collapsed'

export const AppLayout: React.FC = () => (
  <CurrentEventProvider>
    <ChatProvider>
      <Shell />
    </ChatProvider>
  </CurrentEventProvider>
)

const Shell: React.FC = () => {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [collapsed])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  return (
    <div className="min-h-screen bg-ink-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-ink-200 bg-white transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      </aside>

      <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <Topbar />
        <VerifyEmailBanner />
        <main id="main" className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
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
      </div>

      {/* Phones and tablets: iOS-style tab bar + "More" sheet */}
      <BottomTabBar moreOpen={mobileOpen} onMore={() => setMobileOpen(true)} />
      <MoreSheet open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mobile navigation                                                    */

const organizerTabs: NavItem[] = [
  { label: 'Overview', to: '/app', icon: LayoutDashboard, end: true },
  { label: 'Events', to: '/app/events', icon: CalendarDays },
  { label: 'Scan', to: '/app/scanner', icon: ScanLine },
  { label: 'Voting', to: '/app/voting', icon: Vote },
]

const vendorTabs: NavItem[] = [
  { label: 'Overview', to: '/app/business', icon: Store },
  { label: 'Listings', to: '/app/listings', icon: Building2 },
  { label: 'Inquiries', to: '/app/inquiries', icon: Inbox },
]

const adminTabs: NavItem[] = [
  { label: 'Overview', to: '/admin', icon: Gauge, end: true },
  { label: 'Orgs', to: '/admin/organizations', icon: Building2 },
  { label: 'Approvals', to: '/admin/approvals', icon: ShieldCheck },
]

const staffTabs: NavItem[] = [
  { label: 'Overview', to: '/app', icon: LayoutDashboard, end: true },
  { label: 'Scan', to: '/app/scanner', icon: ScanLine },
]

const attendeeTabs = (x: NavExtras): NavItem[] => [
  { label: 'Tickets', to: '/app/my/tickets', icon: Ticket },
  ...(x.marketplace ? [{ label: 'Inquiries', to: '/app/my/inquiries', icon: Inbox }] : []),
  ...(x.payments ? [{ label: 'Payments', to: '/app/my/payments', icon: Receipt }] : []),
  ...(x.reviews ? [{ label: 'Reviews', to: '/app/my/reviews', icon: Star }] : []),
]

const messagesTab = (x: NavExtras): NavItem[] => (x.chat ? [{ label: 'Messages', to: '/app/messages', icon: MessageCircle, badge: x.chatUnread }] : [])

const BottomTabBar: React.FC<{ moreOpen: boolean; onMore: () => void }> = ({ moreOpen, onMore }) => {
  const { user } = useAuth()
  const location = useLocation()
  const x = useNavExtras()
  const tabs = isVendor(user)
    ? vendorTabs
    : user?.role === 'superadmin' && location.pathname.startsWith('/admin')
      ? adminTabs
      : user?.role === 'attendee'
        ? attendeeTabs(x)
        : user && ORGANIZER.includes(user.role)
          ? // With chat on, Messages takes Voting's tab (Voting stays in More)
            [...organizerTabs.slice(0, x.chat ? 3 : 4), ...(user.role === 'organizer' ? messagesTab(x) : [])]
          : [...staffTabs, ...messagesTab(x)]
  // "More" is active when the current page isn't one of the tabs
  const onTab = tabs.some((t) => (t.end ? location.pathname === t.to : location.pathname.startsWith(t.to)))

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200/70 bg-white/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <ul className="mx-auto flex h-[60px] max-w-xl items-stretch">
        {tabs.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink to={t.to} end={t.end} className="group flex h-full flex-col items-center justify-center gap-1">
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200',
                      isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-500 group-active:bg-ink-100',
                    )}
                  >
                    <t.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
                    {!!t.badge && (
                      <span className="absolute -top-1 right-1.5 h-[18px] min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular ring-2 ring-white">
                        {t.badge > 99 ? '99+' : t.badge}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </span>
                  <span className={cn('text-[11px] leading-none', isActive ? 'font-semibold text-brand-700' : 'font-medium text-ink-500')}>
                    {t.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="group flex h-full w-full flex-col items-center justify-center gap-1"
          >
            <span
              className={cn(
                'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200',
                !onTab || moreOpen ? 'bg-brand-50 text-brand-600' : 'text-ink-500 group-active:bg-ink-100',
              )}
            >
              <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={!onTab || moreOpen ? 2.4 : 1.9} aria-hidden />
            </span>
            <span className={cn('text-[11px] leading-none', !onTab || moreOpen ? 'font-semibold text-brand-700' : 'font-medium text-ink-500')}>
              More
            </span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

/** Bottom sheet with everything that isn't a tab, grouped like iOS Settings. */
const MoreSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { user, logout } = useAuth()
  const pendingApprovals = usePendingApprovals(user?.role === 'superadmin')
  const extras = useNavExtras()
  const { currentEvent } = useCurrentEvent()
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.documentElement.style.overflow = 'hidden'
    sheetRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !user) return null

  const name = displayName(user)
  const groups = buildNav(user, pendingApprovals, extras)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(user.role)) }))
    .filter((g) => g.items.length)

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={onClose} />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] animate-sheet-up flex-col rounded-t-[28px] bg-ink-50 shadow-pop outline-none"
      >
        <div className="flex shrink-0 flex-col items-center pt-2">
          <span className="h-1.5 w-10 rounded-full bg-ink-300" aria-hidden />
        </div>
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3">
          <h2 className="text-2xl font-bold text-ink-900">More</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-200/70 text-ink-600 hover:bg-ink-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">
          {/* Account */}
          <div className="flex items-center gap-3 rounded-2xl bg-white p-4">
            <AccountAvatar user={user} name={name} className="h-11 w-11 text-sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink-900">{name}</p>
              <p className="truncate text-sm text-ink-500">
                {roleLabels[user.role]}, {user.email}
              </p>
            </div>
          </div>

          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="mb-1.5 px-4 font-sans text-[13px] font-medium tracking-normal text-ink-500">{g.label}</h3>
              <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn('flex min-h-[52px] items-center gap-3 px-4 active:bg-ink-50', isActive && 'bg-brand-50/60')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', isActive ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600')}>
                            <item.icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className={cn('flex-1 text-[15px]', isActive ? 'font-semibold text-brand-700' : 'text-ink-900')}>{item.label}</span>
                          {!!item.badge && (
                            <span className="h-5 min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-xs font-bold leading-5 text-white">{item.badge}</span>
                          )}
                          <ChevronRight className="h-4 w-4 text-ink-300" aria-hidden />
                        </>
                      )}
                    </NavLink>
                    {item.children?.map((child) => (
                      <Link
                        key={child.to}
                        to={child.to}
                        onClick={onClose}
                        className="flex min-h-[46px] items-center gap-3 border-t border-ink-100 pl-[60px] pr-4 text-[15px] text-ink-700 active:bg-ink-50"
                      >
                        <span className="flex-1">{child.label}</span>
                        {!!child.badge && (
                          <span className="h-5 min-w-5 rounded-full bg-brand-100 px-1.5 text-center text-xs font-bold leading-5 text-brand-700">{child.badge}</span>
                        )}
                        <ChevronRight className="h-4 w-4 text-ink-300" aria-hidden />
                      </Link>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white">
            {currentEvent && (
              <li>
                <a
                  href={`/e/${currentEvent.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[52px] items-center gap-3 px-4 text-[15px] text-ink-900 active:bg-ink-50"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                    <ExternalLink className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="flex-1">Registration page</span>
                </a>
              </li>
            )}
            <li>
              <button onClick={logout} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-red-600 active:bg-ink-50">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <LogOut className="h-[18px] w-[18px]" aria-hidden />
                </span>
                Sign out
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

/**
 * The account's photo or logo, else initials. Business accounts usually upload a logo, so it is shown whole
 * (contained in a rounded square) instead of cropped into a circle.
 */
const AccountAvatar: React.FC<{ user: AuthUser; name: string; className?: string }> = ({ user, name, className }) => {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl(user.avatar)
  const business = user.role === 'organizer' || user.role === 'vendor'
  if (src && !failed)
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={cn('shrink-0 bg-white', business ? 'rounded-lg border border-ink-200 object-contain p-0.5' : 'rounded-full object-cover', className)}
      />
    )
  return <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white', className)}>{initialsOf(name)}</span>
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

const SidebarContent: React.FC<{ collapsed: boolean; onToggleCollapse?: () => void }> = ({ collapsed, onToggleCollapse }) => {
  const { user } = useAuth()
  const location = useLocation()
  const pendingApprovals = usePendingApprovals(user?.role === 'superadmin')
  const extras = useNavExtras()
  const groups = buildNav(user, pendingApprovals, extras)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role))) }))
    .filter((g) => g.items.length)

  return (
    <>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-ink-100', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link to="/app" aria-label="Eventlaya overview">
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-ink-200" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-xs font-medium text-ink-400">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-[10px] text-sm font-medium transition-colors',
                        collapsed ? 'h-10 justify-center' : 'h-10 px-3',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-brand-600" aria-hidden />}
                        <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600')} />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {!!item.badge && (
                          <span
                            className={cn(
                              'rounded-full bg-brand-600 text-center text-[11px] font-bold leading-5 text-white tabular',
                              collapsed ? 'absolute right-1.5 top-1 h-4 min-w-4 px-1 leading-4' : 'h-5 min-w-5 px-1.5',
                            )}
                          >
                            {item.badge}
                            <span className="sr-only"> waiting</span>
                          </span>
                        )}
                        {collapsed && <span className="sr-only">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                  {item.children && !collapsed && (
                    <ul className="ml-[22px] mt-0.5 space-y-0.5 border-l border-ink-200 pl-3">
                      {item.children.map((child) => {
                        const active = subItemActive(child, location.pathname)
                        return (
                          <li key={child.to}>
                            <Link
                              to={child.to}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                                active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                              )}
                            >
                              <span className="flex-1 truncate">{child.label}</span>
                              {!!child.badge && (
                                <span className="h-[18px] min-w-[18px] rounded-full bg-brand-100 px-1.5 text-center text-[11px] font-bold leading-[18px] text-brand-700 tabular">
                                  {child.badge}
                                  <span className="sr-only"> waiting</span>
                                </span>
                              )}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {!collapsed && showsEventChrome(user, location.pathname) && <LiveEventCard />}

      {onToggleCollapse && (
        <div className="border-t border-ink-100 p-3">
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-[10px] text-sm font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-900',
              collapsed ? 'justify-center' : 'px-3',
            )}
          >
            <ChevronsLeft className={cn('h-[18px] w-[18px] transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      )}
    </>
  )
}

/** The current event at a glance: who's inside right now, one tap to the scanner. */
const LiveEventCard: React.FC = () => {
  const { currentEvent } = useCurrentEvent()
  const { data: stats } = useQuery({
    queryKey: ['gateStats', currentEvent?.id],
    queryFn: () => api.getGateStats(currentEvent!.id),
    enabled: Boolean(currentEvent?.id),
    refetchInterval: 5000,
  })
  if (!currentEvent) return null

  const inside = stats?.currently_inside ?? currentEvent.checked_in_count
  const capacity = currentEvent.capacity
  const pct = capacity ? Math.min(100, Math.round((inside / capacity) * 100)) : 0

  return (
    <div className="mx-3 mb-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-ink-900">
      <div className="flex items-center gap-2 text-xs font-medium text-emerald-800">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Inside now
      </div>
      <p className="mt-1.5 font-display text-2xl font-bold tabular">
        {inside}
        {capacity > 0 && <span className="text-sm font-medium text-ink-500"> / {capacity}</span>}
      </p>
      {capacity > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100" aria-hidden>
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      )}
      <Link
        to="/app/scanner"
        className="mt-3 flex h-9 items-center justify-center gap-2 rounded-lg bg-white text-sm font-semibold text-emerald-800 shadow-2xs transition-colors hover:bg-emerald-100"
      >
        <ScanLine className="h-4 w-4" aria-hidden />
        Scan passes
      </Link>
    </div>
  )
}

const NO_EVENT_CHROME = ['/admin', '/app/business', '/app/listings', '/app/inquiries', '/app/availability', '/app/my', '/app/profile', '/app/messages']

const showsEventChrome = (user: ShellUser | null, pathname: string) =>
  !isVendor(user) && user?.role !== 'attendee' && !NO_EVENT_CHROME.some((p) => pathname.startsWith(p))

const BANNER_KEY = 'eventlaya:verify-banner-dismissed'

/** Nudge to confirm the email address (needed before registered passes join the account). */
const VerifyEmailBanner: React.FC = () => {
  const { user } = useAuth()
  const location = useLocation()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(BANNER_KEY) === '1'
    } catch {
      return false
    }
  })
  if (!user || user.email_verified !== false || dismissed) return null
  if (!['attendee', 'organizer', 'vendor'].includes(user.role) || location.pathname.startsWith('/app/messages')) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(BANNER_KEY, '1')
    } catch {
      /* storage unavailable */
    }
  }
  return (
    <div className="border-b border-marigold-200 bg-marigold-50" role="region" aria-label="Verify your email">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <MailWarning className="h-4 w-4 shrink-0 text-marigold-700" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-marigold-900 [overflow-wrap:anywhere]">
          <span className="font-semibold">Verify your email</span>
          {user.role === 'attendee' ? ' so passes you registered with it join your account.' : ' to secure your account.'}
        </p>
        <div className="flex items-center gap-1">
          <Link
            to={`/verify-email?next=${encodeURIComponent(location.pathname + location.search)}`}
            className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-sm font-semibold text-marigold-900 shadow-2xs hover:bg-marigold-100"
          >
            Verify now
          </Link>
          <button type="button" onClick={dismiss} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-marigold-800 hover:bg-marigold-100" aria-label="Dismiss for now">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

const Topbar: React.FC = () => {
  const { currentEvent } = useCurrentEvent()
  const { user } = useAuth()
  const location = useLocation()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200/70 bg-white/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 sm:px-6 lg:h-16">
      <Link to="/app" className="lg:hidden" aria-label="Eventlaya overview">
        <LogoMark className="h-8 w-8" />
      </Link>

      {showsEventChrome(user, location.pathname) ? (
        <EventSwitcher />
      ) : (
        <p className="truncate text-sm font-semibold text-ink-900">
          {location.pathname.startsWith('/admin')
            ? 'Platform console'
            : user?.role === 'attendee' || location.pathname.startsWith('/app/my') || location.pathname.startsWith('/app/profile')
              ? 'Your account'
              : location.pathname.startsWith('/app/messages')
                ? 'Team chat'
                : user?.organization_name || 'Your business'}
        </p>
      )}

      <div className="ml-auto flex items-center gap-2">
        {currentEvent && (
          <a
            href={`/e/${currentEvent.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 md:inline-flex"
          >
            Registration page
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <UserMenu />
      </div>
    </header>
  )
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const formatDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const EventSwitcher: React.FC = () => {
  const { events, currentEvent, setCurrentEventId, isLoading } = useCurrentEvent()
  const [open, setOpen] = useState(false)
  const close = React.useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)

  if (isLoading) return <div className="h-10 w-48 animate-pulse rounded-[10px] bg-ink-100" />
  if (!currentEvent) {
    return (
      <Link to="/app/events" className="text-sm font-semibold text-brand-700 hover:underline">
        Create your first event
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 min-w-0 max-w-[60vw] items-center gap-2.5 rounded-[10px] border border-ink-200 bg-white pl-3 pr-2 text-left shadow-2xs hover:border-ink-300 sm:max-w-sm"
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', phaseMeta[eventPhase(currentEvent)].dot)} title={phaseMeta[eventPhase(currentEvent)].label} aria-hidden />
        <span className="sr-only">{phaseMeta[eventPhase(currentEvent)].label}:</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-900">{currentEvent.title}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch event"
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-pop-in overflow-hidden rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-xs font-medium text-ink-400">Switch event</p>
          {sortByPhase(events).map((e) => (
            <button
              key={e.id}
              role="option"
              aria-selected={e.id === currentEvent.id}
              onClick={() => {
                setCurrentEventId(e.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink-900">{e.title}</span>
                  <PhaseBadge event={e} className="px-2 py-0 text-[11px]" />
                </span>
                <span className="block text-xs text-ink-500">
                  {formatDate(e.start_date)}, {e.location}. {e.registered_count} registered
                </span>
              </span>
              {e.id === currentEvent.id && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
            </button>
          ))}
          <div className="mt-1 border-t border-ink-100 pt-1">
            <Link
              to="/app/events"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2.5 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Manage events
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

const roleLabels: Record<Role, string> = {
  superadmin: 'Platform admin',
  organizer: 'Organizer',
  staff: 'Gate staff',
  attendee: 'Attendee',
  vendor: 'Marketplace business',
}

const UserMenu: React.FC = () => {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const close = React.useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  if (!user) return null

  const name = displayName(user)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 hover:bg-ink-100 sm:pr-2"
      >
        <AccountAvatar user={user} name={name} className="h-8 w-8 text-xs" />
        <ChevronDown className="hidden h-4 w-4 text-ink-400 sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 animate-pop-in rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold text-ink-900">{name}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">{roleLabels[user.role]}</p>
          </div>
          <div className="my-1 h-px bg-ink-100" />
          <Link role="menuitem" to="/app/profile" onClick={close} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-50">
            <UserRound className="h-4 w-4 text-ink-400" aria-hidden />
            Profile
          </Link>
          {user.role !== 'staff' && user.role !== 'vendor' && (
            <Link role="menuitem" to="/app/my/tickets" onClick={close} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-50">
              <Ticket className="h-4 w-4 text-ink-400" aria-hidden />
              My tickets
            </Link>
          )}
          <Link role="menuitem" to="/" className="block rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-50">
            Eventlaya website
          </Link>
          <button
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
          >
            <LogOut className="h-4 w-4 text-ink-400" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
