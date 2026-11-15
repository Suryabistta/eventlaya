import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Check } from 'lucide-react'
import { CalendarToggle } from '@/components/CalendarToggle'
import { BS_MONTHS, toBs, useCalendarSystem } from '@/lib/calendar'
import type { VenueSpace } from '@/services/api'
import { addDays, fmtDay, fmtPrice, parseIso, slotTime, slotsApi, todayIso, type ListingKind, type PublicSlot } from '@/lib/availability'
import { useModuleEnabled } from '@/lib/modules'
import { Card, CardHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'

export const DAYS_AHEAD = 60

export const availabilityKey = (kind: ListingKind, id: string) => ['availability', kind, id] as const

/** Public open slots (plus taken ones, for the calendar strip) for the next 60 days. */
export const usePublicAvailability = (kind: ListingKind, id: string) => {
  const enabled = useModuleEnabled('marketplace')
  return useQuery({
    queryKey: availabilityKey(kind, id),
    queryFn: () => slotsApi.publicList(kind, id, { includeUnavailable: true }),
    enabled: enabled && Boolean(id),
    staleTime: 30_000,
    retry: false,
  })
}

const TAKEN_LABEL: Record<string, string> = { held: 'On hold', booked: 'Booked', blocked: 'Unavailable' }
const TAKEN_CHIP: Record<string, string> = { held: 'bg-marigold-100 text-marigold-900', booked: 'bg-red-100 text-red-800', blocked: 'bg-ink-200 text-ink-700' }
const TAKEN_DAY: Record<string, string> = {
  held: 'border-marigold-200 bg-marigold-50 text-marigold-800',
  booked: 'border-red-200 bg-red-50 text-red-700',
  blocked: 'border-ink-200 bg-ink-200 text-ink-500',
}

/**
 * "Availability" card on a venue / vendor page: a 60-day strip and the open slots grouped by date.
 * Picking a slot hands it to the request form. Renders nothing when the listing has no slots at all.
 */
export const AvailabilitySection: React.FC<{
  kind: ListingKind
  listingId: string
  spaces?: VenueSpace[]
  spaceId?: string
  onSpaceChange?: (id: string) => void
  selectedId?: string | null
  onSelect: (slot: PublicSlot) => void
  formId: string
}> = ({ kind, listingId, spaces = [], spaceId = '', onSpaceChange, selectedId, onSelect, formId }) => {
  const enabled = useModuleEnabled('marketplace')
  const { data, isLoading } = usePublicAvailability(kind, listingId)
  const [day, setDay] = useState<string | null>(null)
  const [system] = useCalendarSystem()
  // Landscape strip by default; viewers can switch to a month box (remembered on this device)
  const [view, setView] = useState<'strip' | 'box'>(() => {
    try { return localStorage.getItem('availability-view') === 'box' ? 'box' : 'strip' } catch { return 'strip' }
  })
  const pickView = (v: 'strip' | 'box') => {
    setView(v)
    try { localStorage.setItem('availability-view', v) } catch { /* private mode */ }
  }

  // A space filter keeps that space's slots plus whole-venue slots.
  const slots = useMemo(
    () => (data?.results ?? []).filter((s) => !spaceId || !s.space || s.space === spaceId),
    [data, spaceId],
  )
  const byDate = useMemo(() => {
    const m = new Map<string, PublicSlot[]>()
    slots.forEach((s) => m.set(s.date, [...(m.get(s.date) ?? []), s]))
    return m
  }, [slots])
  const openDates = useMemo(() => [...byDate.entries()].filter(([, list]) => list.some((s) => s.available)).map(([d]) => d), [byDate])

  if (!enabled) return null
  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Availability" />
        <div className="space-y-3 p-5">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    )
  }
  // No slots (or the lookup failed): the plain inquiry form covers it.
  if (!data || data.results.length === 0) return null

  const start = todayIso()
  const strip = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(start, i))
  const unit = kind === 'venue' ? 'venue' : 'vendor'

  const dayButton = (d: string, size: string) => {
    const list = byDate.get(d) ?? []
    const open = list.filter((s) => s.available).length
    const taken = list.length > 0 && open === 0
    // A full day is amber while a request is pending on it, red once booked, grey when only closed
    const takenTone = list.some((s) => s.status === 'booked') ? 'booked' : list.some((s) => s.status === 'held') ? 'held' : 'blocked'
    const date = parseIso(d)
    const bs = system === 'bs' ? toBs(date) : null
    const dayNum = bs ? bs.day : date.getDate()
    const monthMark = view === 'strip' && (dayNum === 1 || d === start) && (bs ? BS_MONTHS[bs.month].slice(0, 3) : date.toLocaleDateString('en-GB', { month: 'short' }))
    const selected = day === d
    return (
      <button
        key={d}
        type="button"
        disabled={list.length === 0}
        aria-pressed={selected}
        aria-label={`${fmtDay(d, true)}: ${open ? `${open} open slot${open === 1 ? '' : 's'}` : taken ? 'fully booked' : 'no slots'}`}
        onClick={() => setDay(selected ? null : d)}
        className={cn(
          'relative flex flex-col items-center rounded-lg border py-1.5 text-center transition-colors',
          size,
          selected
            ? 'border-brand-600 bg-brand-600 text-white'
            : open
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400'
              : taken
                ? TAKEN_DAY[takenTone]
                : 'border-transparent text-ink-300',
        )}
      >
        {view === 'strip' && <span className="text-[10px] font-semibold uppercase">{date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>}
        <span className={cn('text-sm font-bold tabular', taken && !selected && 'line-through')}>{dayNum}</span>
        {view === 'strip' && <span className="text-[9px] font-medium uppercase leading-none opacity-70">{monthMark || ' '}</span>}
      </button>
    )
  }
  // Box view: the same days grouped by month (Gregorian or BS, following the calendar toggle)
  const months: { key: string; label: string; days: string[] }[] = []
  for (const d of strip) {
    const date = parseIso(d)
    const bs = system === 'bs' ? toBs(date) : null
    const key = bs ? `${bs.year}-${bs.month}` : `${date.getFullYear()}-${date.getMonth()}`
    const label = bs ? `${BS_MONTHS[bs.month]} ${bs.year}` : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const last = months[months.length - 1]
    if (last?.key === key) last.days.push(d)
    else months.push({ key, label, days: [d] })
  }

  const choose = (s: PublicSlot) => {
    onSelect(s)
    const el = document.getElementById(formId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Card id="availability" className="scroll-mt-24">
      <CardHeader
        title="Availability"
        description={`The next ${DAYS_AHEAD} days. Pick a green day, then a slot to request it; the ${unit} confirms with you.`}
        actions={<CalendarToggle />}
      />
      <div className="space-y-4 p-5">
        {spaces.length > 0 && onSpaceChange && (
          <div role="group" aria-label="Filter by space" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {[{ id: '', name: 'All spaces' }, ...spaces].map((s) => (
              <button
                key={s.id || 'all'}
                type="button"
                aria-pressed={spaceId === s.id}
                onClick={() => onSpaceChange(s.id)}
                className={cn(
                  'h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium transition-colors',
                  spaceId === s.id ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div>
          <div role="radiogroup" aria-label="Calendar view" className="mb-3 inline-flex rounded-lg bg-ink-100 p-0.5">
            {(['strip', 'box'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => pickView(v)}
                className={cn('h-7 rounded-md px-3 text-xs font-semibold', view === v ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-900')}>
                {v === 'strip' ? 'Landscape' : 'Box'}
              </button>
            ))}
          </div>
          {view === 'strip' ? (
            <div role="group" aria-label="Pick a day" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2">
              {strip.map((d) => dayButton(d, 'w-11 shrink-0'))}
            </div>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <div key={m.key}>
                  <p className="mb-1.5 text-sm font-semibold text-ink-900">{m.label}</p>
                  <div role="group" aria-label={m.label} className="grid grid-cols-7 gap-1">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
                      <span key={w} className="text-center text-[10px] font-semibold uppercase text-ink-400">{w}</span>
                    ))}
                    {Array.from({ length: parseIso(m.days[0]).getDay() }, (_, i) => <span key={`pad-${i}`} />)}
                    {m.days.map((d) => dayButton(d, 'w-full'))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-100" aria-hidden />
              Open slots
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-marigold-300 bg-marigold-100" aria-hidden />
              On hold
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-red-300 bg-red-100" aria-hidden />
              Booked
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-ink-300" aria-hidden />
              Unavailable
            </span>
          </div>
        </div>

        {openDates.length === 0 ? (
          <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            Every listed slot is taken right now. Send an inquiry with your date and the {unit} will tell you what’s possible.
          </p>
        ) : day ? (
          <section aria-label={fmtDay(day, true)}>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">{fmtDay(day, true)}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {(byDate.get(day) ?? []).map((s) => (
                <li key={s.id}>
                  <SlotChoice slot={s} selected={selectedId === s.id} onChoose={() => choose(s)} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-ink-500">Pick a green day to see its open slots.</p>
        )}
      </div>
    </Card>
  )
}

const SlotChoice: React.FC<{ slot: PublicSlot; selected: boolean; onChoose: () => void }> = ({ slot, selected, onChoose }) => {
  const price = fmtPrice(slot.price)
  if (!slot.available) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-400">
        <span>
          <span className="line-through">{slotTime(slot)}</span>
          {slot.space_name && <span> · {slot.space_name}</span>}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', TAKEN_CHIP[slot.status] ?? TAKEN_CHIP.blocked)}>{TAKEN_LABEL[slot.status] ?? 'Unavailable'}</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors',
        selected ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-emerald-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40',
      )}
    >
      <span className="min-w-0">
        <span className="block font-semibold text-ink-900">{slotTime(slot)}</span>
        {slot.space_name && <span className="block text-ink-600">{slot.space_name}</span>}
        {slot.note && <span className="mt-0.5 block text-xs text-ink-500">{slot.note}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {price && <span className="font-semibold text-ink-900 tabular">{price}</span>}
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', selected ? 'text-brand-700' : 'text-emerald-700')}>
          {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : <CalendarCheck className="h-3.5 w-3.5" aria-hidden />}
          {selected ? 'Selected' : 'Request'}
        </span>
      </span>
    </button>
  )
}
