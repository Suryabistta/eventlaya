import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Check } from 'lucide-react'
import type { VenueSpace } from '@/services/api'
import { addDays, fmtDay, fmtPrice, parseIso, slotTime, slotsApi, todayIso, type ListingKind, type PublicSlot } from '@/lib/availability'
import { useModuleEnabled } from '@/lib/modules'
import { Card, CardHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'

export const DAYS_AHEAD = 60
const DATES_PER_PAGE = 5

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
  const [pages, setPages] = useState(1)

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
  const shownDates = day ? [day] : openDates.slice(0, pages * DATES_PER_PAGE)
  const unit = kind === 'venue' ? 'venue' : 'vendor'

  const choose = (s: PublicSlot) => {
    onSelect(s)
    const el = document.getElementById(formId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Card id="availability" className="scroll-mt-24">
      <CardHeader
        title="Availability"
        description={`Open slots for the next ${DAYS_AHEAD} days. Pick one to request it; the ${unit} confirms with you.`}
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
          <div role="group" aria-label="Pick a day" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2">
            {strip.map((d) => {
              const list = byDate.get(d) ?? []
              const open = list.filter((s) => s.available).length
              const taken = list.length > 0 && open === 0
              const date = parseIso(d)
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
                    'relative flex w-11 shrink-0 flex-col items-center rounded-lg border py-1.5 text-center transition-colors',
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : open
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400'
                        : taken
                          ? 'border-ink-100 bg-ink-100 text-ink-400'
                          : 'border-transparent text-ink-300',
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase">{date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>
                  <span className={cn('text-sm font-bold tabular', taken && !selected && 'line-through')}>{date.getDate()}</span>
                  <span className="text-[9px] font-medium uppercase leading-none opacity-70">
                    {date.getDate() === 1 || d === start ? date.toLocaleDateString('en-GB', { month: 'short' }) : ' '}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-100" aria-hidden />
              Open slots
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-ink-200" aria-hidden />
              Booked or unavailable
            </span>
          </div>
        </div>

        {openDates.length === 0 && !day ? (
          <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            Every listed slot is taken right now. Send an inquiry with your date and the {unit} will tell you what’s possible.
          </p>
        ) : (
          <div className="space-y-4">
            {day && (
              <button type="button" onClick={() => setDay(null)} className="text-sm font-medium text-brand-700 hover:underline">
                Show all open dates
              </button>
            )}
            {shownDates.map((d) => (
              <section key={d} aria-label={fmtDay(d, true)}>
                <h3 className="mb-2 text-sm font-semibold text-ink-900">{fmtDay(d, true)}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(byDate.get(d) ?? []).filter((s) => day || s.available).map((s) => (
                    <li key={s.id}>
                      <SlotChoice slot={s} selected={selectedId === s.id} onChoose={() => choose(s)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!day && openDates.length > shownDates.length && (
              <button type="button" onClick={() => setPages((p) => p + 1)} className="text-sm font-medium text-brand-700 hover:underline">
                Show more dates ({openDates.length - shownDates.length} more)
              </button>
            )}
          </div>
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
        <span className="text-xs font-semibold">{TAKEN_LABEL[slot.status] ?? 'Unavailable'}</span>
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
