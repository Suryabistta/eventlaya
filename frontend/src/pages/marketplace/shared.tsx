import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BadgeCheck, Building2, ChevronLeft, ImageOff, PauseCircle, Star } from 'lucide-react'
import { marketplaceApi, request, type Vendor, type VenueListing, type VenueSpace, type VenueWithSpaces } from '@/services/api'
import { ButtonLink, Card, EmptyState, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

export const CITIES = ['Dharan', 'Itahari', 'Biratnagar', 'Damak', 'Kathmandu']

export const VENUE_TYPES = [
  { value: 'banquet', label: 'Banquet hall' },
  { value: 'auditorium', label: 'Auditorium' },
  { value: 'resort', label: 'Resort and lawn' },
  { value: 'hotel', label: 'Hotel ballroom' },
  { value: 'open_ground', label: 'Open ground' },
  { value: 'community', label: 'Community hall' },
] as const

export const SPACE_TYPES: { value: VenueSpace['space_type']; label: string }[] = [
  { value: 'hall', label: 'Hall' },
  { value: 'auditorium', label: 'Auditorium' },
  { value: 'lawn', label: 'Lawn' },
  { value: 'rooftop', label: 'Rooftop' },
  { value: 'conference_room', label: 'Conference room' },
  { value: 'other', label: 'Other' },
]

export const spaceTypeLabel = (t: VenueSpace['space_type']) => SPACE_TYPES.find((x) => x.value === t)?.label ?? t

/** "600 seated, 900 standing" */
export const spaceCapacity = (s: Pick<VenueSpace, 'capacity_seated' | 'capacity_standing'>) =>
  [s.capacity_seated ? `${s.capacity_seated.toLocaleString()} seated` : '', s.capacity_standing ? `${s.capacity_standing.toLocaleString()} standing` : '']
    .filter(Boolean)
    .join(', ')

const INDOOR: VenueSpace['space_type'][] = ['hall', 'auditorium', 'conference_room']
/** "4 halls" when every space is indoors, otherwise "4 spaces". */
export const spaceCountLabel = (spaces: Pick<VenueSpace, 'space_type'>[]) => {
  const n = spaces.length
  const noun = spaces.every((s) => INDOOR.includes(s.space_type)) ? 'hall' : 'space'
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export const formatRs = (value: string | number) => `Rs ${Number(value).toLocaleString('en-IN')}`

/* ---------------------------------------------------------------- API */

const isNotFound = (err: unknown) => err instanceof Error && /not found|no .* matches the given query|request failed \(404\)/i.test(err.message)

/** Venues are addressed by slug in URLs; the list endpoint filters by it. */
export const fetchVenueBySlug = (slug: string): Promise<VenueWithSpaces | null> => marketplaceApi.getVenueBySlug(slug)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchVendor(id: string): Promise<Vendor | null> {
  if (!UUID.test(id)) return null
  try {
    return await request<Vendor>(`/marketplace/vendors/${encodeURIComponent(id)}/`)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Surface query failures as a toast as well as inline (once per failure). */
export function useErrorToast(isError: boolean, error: Error | null, title: string) {
  const toast = useToast()
  useEffect(() => {
    if (isError) toast.error(title, error?.message || 'Check your connection and try again.')
  }, [isError, error])
}

/* ------------------------------------------------------------ Routing */

/** '/app/marketplace' inside the app shell, '/marketplace' on the public site. */
export function useMarketplaceBase() {
  const inApp = useLocation().pathname.startsWith('/app')
  return { inApp, base: inApp ? '/app/marketplace' : '/marketplace' }
}

export const venuePath = (base: string, v: VenueListing) => `${base}/venues/${v.slug}`
export const vendorPath = (base: string, v: Vendor) => `${base}/vendors/${v.id}`

/* --------------------------------------------------------- UI pieces */

export const Rating: React.FC<{ value: string | number; count?: number }> = ({ value, count }) => (
  <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-800">
    <Star className="h-4 w-4 fill-marigold-400 text-marigold-400" aria-hidden />
    <span className="sr-only">Rated</span>
    {Number(value).toFixed(1)}
    {count !== undefined && (
      <span className="font-normal text-ink-500">
        ({count}
        <span className="sr-only"> reviews</span>)
      </span>
    )}
  </span>
)

export const Verified: React.FC<{ label: string }> = ({ label }) => (
  <span className="ml-1.5 inline-flex items-center align-[-3px] text-emerald-600" title={label}>
    <BadgeCheck className="h-[18px] w-[18px]" aria-hidden />
    <span className="sr-only">{label}</span>
  </span>
)

/** Image with a neutral placeholder when the URL is missing or fails to load. */
export const Photo: React.FC<{ src?: string; alt?: string; className?: string; icon?: React.ElementType }> = ({
  src,
  alt = '',
  className,
  icon: Icon = Building2,
}) => {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 bg-ink-100 text-ink-400', className)} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        {src ? <ImageOff className="h-7 w-7" aria-hidden /> : <Icon className="h-8 w-8" aria-hidden />}
        <span className="text-xs font-medium">{src ? 'Photo unavailable' : 'No photo yet'}</span>
      </div>
    )
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('object-cover', className)} />
}

export const BackLink: React.FC<{ to: string; label?: string }> = ({ to, label = 'Vendors and venues' }) => (
  <nav aria-label="Breadcrumb">
    <Link to={to} className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-ink-600 hover:text-ink-900">
      <ChevronLeft className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  </nav>
)

export const NotFound: React.FC<{ what: string; base: string }> = ({ what, base }) => (
  <Card>
    <EmptyState
      icon={<Building2 className="h-6 w-6" />}
      title={`We couldn’t find that ${what}`}
      description={`It may have been removed, or the link is wrong.`}
      action={<ButtonLink to={base}>Browse vendors and venues</ButtonLink>}
    />
  </Card>
)

/** Wrapper that matches the list page: app padding in the shell, marketing padding outside. */
export const DetailShell: React.FC<{ inApp: boolean; children: React.ReactNode }> = ({ inApp, children }) => (
  <div className={inApp ? 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 pb-28 lg:py-8 lg:pb-8 2xl:px-10' : 'mx-auto max-w-6xl space-y-6 px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:pb-12'}>
    {children}
  </div>
)

/** Two-column detail layout: content 8 / sticky aside 4 on wide screens. */
export const DETAIL_GRID = 'grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-12'
export const DETAIL_MAIN = 'min-w-0 space-y-6 xl:col-span-8'
export const DETAIL_ASIDE = 'min-w-0 lg:sticky lg:top-24 xl:col-span-4'

/** Definition list row for key facts. */
export const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-4 py-3 sm:grid-cols-[180px_1fr]">
    <dt className="text-sm text-ink-500">{label}</dt>
    <dd className="min-w-0 text-sm text-ink-900">{children}</dd>
  </div>
)

/** Mobile-only sticky bar that scrolls to the inline form. */
/** Fixed bottom bar for phones. In the app shell it sits above the tab bar (60px). */
export const mobileBarClass = (inApp: boolean) =>
  cn(
    'fixed inset-x-0 z-30 border-t border-ink-200 bg-white/95 px-4 pt-3 backdrop-blur lg:hidden',
    inApp ? 'bottom-[calc(60px+env(safe-area-inset-bottom))] pb-3' : 'bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
  )

/** Shown instead of the inquiry form / booking when the owner has paused the listing. */
export const NotTakingRequests: React.FC<{ name: string; isOwner?: boolean; className?: string }> = ({ name, isOwner, className }) => (
  <Card className={cn('p-5 sm:p-6', className)} role="status">
    <PauseCircle className="h-8 w-8 text-ink-400" aria-hidden />
    <h2 className="mt-3 text-lg font-bold text-ink-900">Not taking requests right now</h2>
    <p className="mt-1 text-sm text-ink-600">
      {isOwner
        ? 'You paused this listing, so it’s hidden from the marketplace and new requests are turned off. Resume it from Listings.'
        : `${name} has paused new requests for now. You can still reach them using the contact details on this page.`}
    </p>
    {isOwner && (
      <ButtonLink to="/app/listings" variant="secondary" size="sm" className="mt-4">
        Go to Listings
      </ButtonLink>
    )}
  </Card>
)

export const MobileActionBar: React.FC<{ targetId: string; label: string; summary: React.ReactNode }> = ({ targetId, label, summary }) => (
  <div className={mobileBarClass(useLocation().pathname.startsWith('/app'))}>
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 text-sm text-ink-600">{summary}</div>
      <button
        type="button"
        onClick={() => {
          const el = document.getElementById(targetId)
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          el?.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true })
        }}
        className="inline-flex h-10 shrink-0 items-center rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-brand-700"
      >
        {label}
      </button>
    </div>
  </div>
)

interface ChipOption {
  value: string
  label: string
}

/**
 * Single-select filter chips. They wrap onto more lines on narrow screens so every option
 * stays visible (a sideways-scrolling row cut the last chips off at the screen edge).
 */
export const FilterChips: React.FC<{
  label: string
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}> = ({ label, options, value, onChange, className }) => (
  <div
    role="group"
    aria-label={label}
    className={cn('flex flex-wrap gap-2', className)}
  >
    {options.map((o) => {
      const active = o.value === value
      return (
        <button
          key={o.value || 'all'}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors',
            active
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
          )}
        >
          {o.label}
        </button>
      )
    })}
  </div>
)
