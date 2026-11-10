import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  Clock,
  LayoutGrid,
  List,
  Lock,
  Mail,
  Pencil,
  Phone,
  Repeat,
  Store,
  Trash2,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react'
import { isApiError, isModuleDisabled } from '@/services/api'
import { apiErrorText, fmtDay, fmtPrice, parseIso, slotTime, slotsApi, todayIso, SLOT_STATUS, type Slot, type SlotStatus } from '@/lib/availability'
import { useModuleEnabled } from '@/lib/modules'
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, buttonClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PAGE, useMyListings } from '../ListingsPage'
import { InquiryStatusBadge } from '../status'
import { timeAgo } from '../InquiriesPage'
import { DecisionModal, type Decision, type DecisionTarget } from '../DecisionModal'
import { BlockDatesModal, DeleteSlotModal, PresetsModal, RepeatSlotsModal, SlotFormModal } from './SlotDialogs'
import { Legend, MonthNav, SpaceSelect, StatusDot, WeekdayHeader, bsDayOf, monthGrid, monthOf, type ListingRef } from './shared'
import { CalendarToggle } from '@/components/CalendarToggle'
import { useCalendarSystem } from '@/lib/calendar'

const MAX_CHIPS = 3

/** Business portal: availability calendar for one venue / service profile. */
export const AvailabilityPage: React.FC = () => {
  useCalendarSystem() // re-render dates when the viewer switches BS / AD
  const marketplaceOn = useModuleEnabled('marketplace')
  const listingsQ = useMyListings()
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const [view, setView] = useState<'month' | 'list'>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'list' : 'month'))
  const [slotForm, setSlotForm] = useState<{ slot?: Slot | null; date?: string } | null>(null)
  const [repeatOpen, setRepeatOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [deleting, setDeleting] = useState<Slot | null>(null)
  const [deciding, setDeciding] = useState<{ target: DecisionTarget; decision: Decision } | null>(null)

  const listings: ListingRef[] = useMemo(() => {
    const d = listingsQ.data
    if (!d) return []
    return [
      ...d.venues.map((v) => ({ key: `venue:${v.id}`, kind: 'venue' as const, id: v.id, name: v.name, spaces: (v.spaces ?? []).filter((s) => s.is_active !== false), status: v.listing_status, presets: v.slot_presets ?? [] })),
      ...d.vendor_profiles.map((p) => ({ key: `vendor:${p.id}`, kind: 'vendor' as const, id: p.id, name: p.business_name, spaces: [], status: p.listing_status, presets: p.slot_presets ?? [] })),
    ]
  }, [listingsQ.data])

  const listing = listings.find((l) => l.key === params.get('listing')) ?? listings[0]
  const space = listing?.kind === 'venue' ? (params.get('space') ?? '') : ''
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? (params.get('month') as string) : monthOf(today)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') ?? '') ? (params.get('day') as string) : null
  const grid = monthGrid(month)

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }

  const slotsQ = useQuery({
    queryKey: ['my-slots', listing?.key, grid.start, grid.end],
    queryFn: () => slotsApi.list({ ...(listing!.kind === 'venue' ? { venue: listing!.id } : { vendor: listing!.id }), from: grid.start, to: grid.end }),
    enabled: Boolean(listing) && marketplaceOn,
    placeholderData: keepPreviousData,
  })

  // A space filter shows that space's slots plus whole-venue slots (which also cover it).
  const slots = useMemo(() => (slotsQ.data?.results ?? []).filter((s) => !space || !s.space || s.space === space), [slotsQ.data, space])
  const byDate = useMemo(() => {
    const m = new Map<string, Slot[]>()
    slots.forEach((s) => m.set(s.date, [...(m.get(s.date) ?? []), s]))
    return m
  }, [slots])
  const counts = useMemo(() => {
    const c: Partial<Record<SlotStatus, number>> = {}
    slots.filter((s) => s.date >= grid.first && s.date <= grid.last).forEach((s) => (c[s.status] = (c[s.status] ?? 0) + 1))
    return c
  }, [slots, grid.first, grid.last])

  // Keep the selected day inside the visible month.
  useEffect(() => {
    if (day && monthOf(day) !== month) setParam({ day: null })
  }, [month])

  const pickDay = (d: string) => {
    setParam({ day: d, ...(monthOf(d) !== month ? { month: monthOf(d) } : {}) })
    if (window.innerWidth < 1024) setTimeout(() => document.getElementById('day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  if (!marketplaceOn || isModuleDisabled(listingsQ.error) || isModuleDisabled(slotsQ.error)) {
    return (
      <div className={PAGE}>
        <PageHeader title="Availability" />
        <Card>
          <EmptyState icon={<Store className="h-6 w-6" />} title="The marketplace is turned off" description="Availability and booking requests aren’t available right now." />
        </Card>
      </div>
    )
  }

  if (listingsQ.isLoading) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[480px] rounded-2xl" />
      </div>
    )
  }
  if (listingsQ.isError) {
    return (
      <div className={PAGE}>
        <PageHeader title="Availability" />
        <ErrorState message={listingsQ.error?.message} onRetry={listingsQ.refetch} />
      </div>
    )
  }
  if (!listing) {
    return (
      <div className={PAGE}>
        <PageHeader title="Availability" description="Open dates and times customers can request, and the requests holding them." />
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Add a listing first"
            description="Slots belong to a venue or a service profile. Once you have one, open its calendar here."
            action={<ButtonLink to="/app/listings">Go to listings</ButtonLink>}
          />
        </Card>
      </div>
    )
  }

  const daySlots = day ? (byDate.get(day) ?? []) : []
  const listDays = [...byDate.keys()].filter((d) => d >= grid.first && d <= grid.last).sort()

  return (
    <div className={PAGE}>
      <PageHeader
        title="Availability"
        description="Open dates and times customers can request. Requests hold a slot until you confirm or decline."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPresetsOpen(true)} icon={<Clock className="h-4 w-4" aria-hidden />}>
              Time slots
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setBlockOpen(true)} icon={<CalendarX className="h-4 w-4" aria-hidden />}>
              Block dates
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRepeatOpen(true)} icon={<Repeat className="h-4 w-4" aria-hidden />}>
              Repeat slots
            </Button>
            <Button size="sm" onClick={() => setSlotForm({ date: day && day >= today ? day : today })} icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
              Add slot
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select label="Listing" value={listing.key} onChange={(e) => setParam({ listing: e.target.value, space: null, day: null })} containerClassName="sm:w-72">
          {listings.some((l) => l.kind === 'venue') && (
            <optgroup label="Venues">
              {listings
                .filter((l) => l.kind === 'venue')
                .map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
            </optgroup>
          )}
          {listings.some((l) => l.kind === 'vendor') && (
            <optgroup label="Services">
              {listings
                .filter((l) => l.kind === 'vendor')
                .map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
            </optgroup>
          )}
        </Select>
        <SpaceSelect listing={listing} value={space} onChange={(v) => setParam({ space: v || null })} allLabel="All spaces" className="sm:w-56" />
      </div>

      {listing.status && listing.status !== 'approved' && (
        <p role="status" className="rounded-xl border border-marigold-200 bg-marigold-50 px-4 py-2.5 text-sm text-marigold-900">
          This listing isn’t live yet. You can set up slots now; customers see them once it’s approved.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5">
            <MonthNav month={month} onChange={(m) => setParam({ month: m })} />
            <div className="flex items-center gap-2">
              <CalendarToggle />
              {month !== monthOf(today) && (
                <button type="button" onClick={() => setParam({ month: null, day: today })} className={buttonClass('ghost', 'sm')}>
                  Today
                </button>
              )}
              <div className="inline-flex rounded-lg bg-ink-100 p-0.5" role="group" aria-label="View">
                {(
                  [
                    ['month', 'Month', LayoutGrid],
                    ['list', 'List', List],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold',
                      view === v ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="px-4 pt-3 sm:px-5">
            <Legend counts={counts} />
          </div>

          {slotsQ.isError ? (
            <div className="p-5">
              <ErrorState message={slotsQ.error?.message} onRetry={slotsQ.refetch} />
            </div>
          ) : view === 'month' ? (
            <div className={cn('p-2 sm:p-4', slotsQ.isFetching && 'opacity-70 transition-opacity')}>
              <WeekdayHeader />
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200">
                {grid.days.map((d) => (
                  <DayCell key={d} date={d} slots={byDate.get(d) ?? []} inMonth={d >= grid.first && d <= grid.last} today={today} selected={d === day} onPick={() => pickDay(d)} />
                ))}
              </div>
            </div>
          ) : (
            <AgendaList days={listDays} byDate={byDate} selected={day} today={today} onPick={pickDay} loading={slotsQ.isLoading} />
          )}
        </Card>

        <div id="day-panel" className="min-w-0 scroll-mt-20 lg:col-span-4">
          <DayPanel
            day={day}
            today={today}
            slots={daySlots}
            listing={listing}
            onAdd={() => setSlotForm({ date: day ?? today })}
            onBlockDay={() => setBlockOpen(true)}
            onEdit={(s) => setSlotForm({ slot: s })}
            onDelete={setDeleting}
            onDecide={(s, decision) =>
              s.request &&
              setDeciding({
                decision,
                target: { kind: s.request.kind, id: s.request.id, customer: s.request.sender_name, summary: [fmtDay(s.date), slotTime(s), s.space_name].filter(Boolean).join(' · ') },
              })
            }
          />
        </div>
      </div>

      <SlotFormModal open={Boolean(slotForm)} onClose={() => setSlotForm(null)} listing={listing} slot={slotForm?.slot} date={slotForm?.date} space={space} />
      {presetsOpen && <PresetsModal listing={listing} onClose={() => setPresetsOpen(false)} />}
      <RepeatSlotsModal open={repeatOpen} onClose={() => setRepeatOpen(false)} listing={listing} date={day ?? (month > monthOf(today) ? `${month}-01` : undefined)} space={space} />
      <BlockDatesModal open={blockOpen} onClose={() => setBlockOpen(false)} listing={listing} date={day ?? undefined} space={space} month={month} />
      <DeleteSlotModal slot={deleting} onClose={() => setDeleting(null)} />
      <DecisionModal target={deciding?.target ?? null} decision={deciding?.decision ?? 'confirm'} onClose={() => setDeciding(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ Calendar */

const shortTime = (s: Slot) => (s.start_time && s.end_time ? `${s.start_time.replace(/:00$/, '')}–${s.end_time.replace(/:00$/, '')}` : 'Full day')

const DayCell: React.FC<{ date: string; slots: Slot[]; inMonth: boolean; today: string; selected: boolean; onPick: () => void }> = ({
  date,
  slots,
  inMonth,
  today,
  selected,
  onPick,
}) => {
  const past = date < today
  const n = Number(date.slice(8))
  const bs = bsDayOf(date)
  const label = `${fmtDay(date, true)}${slots.length ? `, ${slots.length} slot${slots.length === 1 ? '' : 's'}: ${slots.map((s) => SLOT_STATUS[s.status].label).join(', ')}` : ', no slots'}`
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        'relative flex min-h-[64px] flex-col items-stretch gap-1 p-1 text-left transition-colors sm:min-h-[104px] sm:p-1.5',
        inMonth ? 'bg-white hover:bg-ink-50' : 'bg-ink-50/70 text-ink-400 hover:bg-ink-50',
        past && inMonth && 'bg-ink-50/40',
        selected && 'z-10 ring-2 ring-inset ring-brand-600',
      )}
    >
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold tabular',
          date === today ? 'bg-brand-600 text-white' : past ? 'text-ink-400' : inMonth ? 'text-ink-800' : 'text-ink-400',
        )}
      >
        {n}
      </span>
      {bs !== null && (
        <span className="absolute right-1 top-1 text-[10px] font-medium text-ink-400 tabular sm:right-1.5 sm:top-1.5" title="BS date">
          {bs}
        </span>
      )}
      {/* Phones: dots */}
      {slots.length > 0 && (
        <span className="flex flex-wrap gap-0.5 px-0.5 sm:hidden" aria-hidden>
          {slots.slice(0, 4).map((s) => (
            <StatusDot key={s.id} status={s.status} />
          ))}
        </span>
      )}
      {/* Larger screens: chips */}
      <span className="hidden flex-col gap-0.5 sm:flex" aria-hidden>
        {slots.slice(0, MAX_CHIPS).map((s) => (
          <span key={s.id} className={cn('truncate rounded border px-1 py-px text-[11px] font-medium leading-4', SLOT_STATUS[s.status].chip, past && 'opacity-60')}>
            {shortTime(s)}
            {s.space_name ? ` · ${s.space_name}` : ''}
          </span>
        ))}
        {slots.length > MAX_CHIPS && <span className="px-1 text-[11px] font-medium text-ink-500">+{slots.length - MAX_CHIPS} more</span>}
      </span>
    </button>
  )
}

const AgendaList: React.FC<{ days: string[]; byDate: Map<string, Slot[]>; selected: string | null; today: string; onPick: (d: string) => void; loading: boolean }> = ({
  days,
  byDate,
  selected,
  today,
  onPick,
  loading,
}) => {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    )
  }
  if (days.length === 0) {
    return <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No slots this month" description="Add a slot, or use Repeat slots to fill several weeks at once." />
  }
  return (
    <ul className="divide-y divide-ink-100 px-1 py-2">
      {days.map((d) => (
        <li key={d}>
          <button
            type="button"
            onClick={() => onPick(d)}
            aria-pressed={selected === d}
            className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-ink-50', selected === d && 'bg-brand-50/60', d < today && 'opacity-60')}
          >
            <span className="w-12 shrink-0 text-center">
              <span className="block text-[11px] font-semibold uppercase text-ink-500">{parseIso(d).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <span className={cn('block text-lg font-bold tabular', d === today ? 'text-brand-700' : 'text-ink-900')}>{Number(d.slice(8))}</span>
              {bsDayOf(d) !== null && <span className="block text-[10px] font-medium text-ink-400 tabular">BS {bsDayOf(d)}</span>}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              {(byDate.get(d) ?? []).map((s) => (
                <span key={s.id} className={cn('flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1 text-[13px]', SLOT_STATUS[s.status].chip)}>
                  <span className="truncate font-medium">
                    {slotTime(s)}
                    {s.space_name ? ` · ${s.space_name}` : ''}
                  </span>
                  <span className="shrink-0 text-xs font-semibold">{s.request ? s.request.sender_name : SLOT_STATUS[s.status].label}</span>
                </span>
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ Day panel */

const DayPanel: React.FC<{
  day: string | null
  today: string
  slots: Slot[]
  listing: ListingRef
  onAdd: () => void
  onBlockDay: () => void
  onEdit: (s: Slot) => void
  onDelete: (s: Slot) => void
  onDecide: (s: Slot, d: Decision) => void
}> = ({ day, today, slots, listing, onAdd, onBlockDay, onEdit, onDelete, onDecide }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const setStatus = useMutation({
    mutationFn: ({ slot, status }: { slot: Slot; status: 'open' | 'blocked' }) => slotsApi.update(slot.id, { status }),
    onSuccess: (saved) => toast.success(saved.status === 'blocked' ? 'Slot blocked' : 'Slot open again', `${fmtDay(saved.date)}, ${slotTime(saved).toLowerCase()}`),
    onError: (err) =>
      isApiError(err, 'slot_locked')
        ? toast.error('A customer just requested this slot', 'Slots with a booking request can’t be blocked. Decline the request first.')
        : toast.error('Couldn’t change the slot', apiErrorText(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['my-slots'] }),
  })

  if (!day) {
    return (
      <Card className="p-5">
        <p className="font-semibold text-ink-900">Pick a day</p>
        <p className="mt-1 text-sm text-ink-500">Choose a day on the calendar to add slots, block it, or answer the requests on it.</p>
        <ul className="mt-4 space-y-2 text-sm text-ink-600">
          <li className="flex gap-2">
            <StatusDot status="open" className="mt-1.5" /> Open slots can be requested by customers on {listing.name}’s page.
          </li>
          <li className="flex gap-2">
            <StatusDot status="held" className="mt-1.5" /> A request holds the slot until you confirm or decline.
          </li>
          <li className="flex gap-2">
            <StatusDot status="blocked" className="mt-1.5" /> Blocked days stay closed for requests.
          </li>
        </ul>
      </Card>
    )
  }

  const past = day < today
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-ink-900">{fmtDay(day, true)}</h2>
          <p className="text-sm text-ink-500">
            {slots.length ? `${slots.length} slot${slots.length === 1 ? '' : 's'}` : 'No slots'}
            {past && ' · in the past'}
          </p>
        </div>
        {!past && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onBlockDay} icon={<Ban className="h-4 w-4" aria-hidden />}>
              Block
            </Button>
            <Button size="sm" onClick={onAdd} icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
              Add slot
            </Button>
          </div>
        )}
      </div>
      {slots.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">{past ? 'Nothing was scheduled on this day.' : 'Customers can’t request this day yet. Add a slot to open it.'}</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {slots.map((s) => (
            <li key={s.id} className="space-y-3 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-ink-900">
                    <Clock className="h-4 w-4 text-ink-400" aria-hidden />
                    {slotTime(s)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {listing.kind === 'venue' && (s.space_name || 'Whole venue')}
                    {listing.kind === 'venue' && s.effective_price && ' · '}
                    {s.effective_price && <span className="whitespace-nowrap tabular">{fmtPrice(s.effective_price)}</span>}
                    {!s.price && s.effective_price && <span className="text-ink-400"> (listing price)</span>}
                  </p>
                  {s.note && <p className="mt-1 text-sm text-ink-500">{s.note}</p>}
                </div>
                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold', SLOT_STATUS[s.status].chip)}>{SLOT_STATUS[s.status].label}</span>
              </div>

              {s.request ? (
                <RequestSummary slot={s} onDecide={(d) => onDecide(s, d)} />
              ) : s.status === 'held' || s.status === 'booked' ? (
                <p className="text-sm text-ink-500">
                  This slot has a request. See it in <Link to="/app/inquiries?bookings=1" className="font-medium text-brand-700 hover:underline">Inquiries</Link>.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {s.status === 'open' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={setStatus.isPending && setStatus.variables?.slot.id === s.id}
                      onClick={() => setStatus.mutate({ slot: s, status: 'blocked' })}
                      icon={<Ban className="h-4 w-4" aria-hidden />}
                    >
                      Block
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={setStatus.isPending && setStatus.variables?.slot.id === s.id}
                      onClick={() => setStatus.mutate({ slot: s, status: 'open' })}
                      icon={<Undo2 className="h-4 w-4" aria-hidden />}
                    >
                      Unblock
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onEdit(s)} icon={<Pencil className="h-4 w-4" aria-hidden />}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(s)} icon={<Trash2 className="h-4 w-4" aria-hidden />} className="text-red-700 hover:bg-red-50 hover:text-red-800">
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const RequestSummary: React.FC<{ slot: Slot; onDecide: (d: Decision) => void }> = ({ slot, onDecide }) => {
  const r = slot.request!
  const held = slot.status === 'held'
  return (
    <div className={cn('space-y-2.5 rounded-xl border p-3.5', held ? 'border-marigold-200 bg-marigold-50/50' : 'border-brand-100 bg-brand-50/40')}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink-900">{r.sender_name}</p>
        <InquiryStatusBadge status={r.status} />
        <span className="text-xs text-ink-500">{timeAgo(r.created_at)}</span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700">
        {r.event_type && (
          <div>
            <dt className="sr-only">Event</dt>
            <dd>{r.event_type}</dd>
          </div>
        )}
        {r.guest_count !== null && r.guest_count !== undefined && (
          <div className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-ink-400" aria-hidden />
            <dt className="sr-only">Guests</dt>
            <dd>{r.guest_count.toLocaleString()} guests</dd>
          </div>
        )}
        {r.budget_range && (
          <div className="inline-flex items-center gap-1">
            <Wallet className="h-3.5 w-3.5 text-ink-400" aria-hidden />
            <dt className="sr-only">Budget</dt>
            <dd>{r.budget_range}</dd>
          </div>
        )}
      </dl>
      {r.message && <p className="line-clamp-4 whitespace-pre-line text-sm text-ink-700">{r.message}</p>}
      {r.owner_note && (
        <p className="text-sm text-ink-600">
          <span className="font-medium text-ink-800">Your note: </span>
          {r.owner_note}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`tel:${r.sender_phone}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          <Phone className="h-3.5 w-3.5" aria-hidden />
          {r.sender_phone}
        </a>
        <a href={`mailto:${r.sender_email}`} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-brand-700 hover:underline">
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{r.sender_email}</span>
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {held && (
          <Button size="sm" onClick={() => onDecide('confirm')} icon={<CalendarCheck className="h-4 w-4" aria-hidden />}>
            Confirm
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onDecide('decline')} icon={<CalendarX className="h-4 w-4" aria-hidden />}>
          {held ? 'Decline' : 'Cancel booking'}
        </Button>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-500">
          <Lock className="h-3 w-3" aria-hidden />
          Can’t edit while requested
        </span>
      </div>
    </div>
  )
}

export default AvailabilityPage
