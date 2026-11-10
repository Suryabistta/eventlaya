import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BS_MONTHS, calendarSystem, toBs } from '@/lib/calendar'
import type { VenueSpace } from '@/services/api'
import { addDays, apiWeekday, isoDate, parseIso, SLOT_STATUS, WEEKDAYS, type SlotStatus, type SlotTarget } from '@/lib/availability'
import { cn } from '@/lib/utils'

/** The venue or service profile whose calendar is open. */
export interface ListingRef {
  key: string
  kind: 'venue' | 'vendor'
  id: string
  name: string
  spaces: VenueSpace[]
  status?: string
  /** Owner's saved time slots (Morning 7–11…); empty = whole day only */
  presets: SlotPreset[]
}

export interface SlotPreset {
  name: string
  start: string
  end: string
}

export const toTarget = (l: ListingRef, space?: string | null): SlotTarget =>
  l.kind === 'venue' ? { venue: l.id, space: space || null } : { vendor: l.id }

/** "2026-11" -> the Monday-first grid of days covering that month. */
export const monthGrid = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const first = isoDate(new Date(y, m - 1, 1))
  const last = isoDate(new Date(y, m, 0))
  const start = addDays(first, -apiWeekday(first))
  const end = addDays(last, 6 - apiWeekday(last))
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return { first, last, start, end, days }
}

export const monthOf = (iso: string) => iso.slice(0, 7)
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7)
}
/** "November 2026"; with BS on, the BS months it spans: "Kartik – Mangsir 2083". */
export const monthLabel = (month: string) => {
  const first = parseIso(`${month}-01`)
  const ad = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (calendarSystem() !== 'bs') return ad
  const a = toBs(first)
  const b = toBs(new Date(first.getFullYear(), first.getMonth() + 1, 0))
  if (!a || !b) return ad
  return a.year === b.year
    ? `${BS_MONTHS[a.month]} – ${BS_MONTHS[b.month]} ${b.year}`
    : `${BS_MONTHS[a.month]} ${a.year} – ${BS_MONTHS[b.month]} ${b.year}`
}

/** The BS day of the month for an ISO date when BS is on, else null (shown small beside the AD day). */
export const bsDayOf = (iso: string) => (calendarSystem() === 'bs' ? (toBs(parseIso(iso))?.day ?? null) : null)

export const MonthNav: React.FC<{ month: string; onChange: (m: string) => void; min?: string; className?: string }> = ({ month, onChange, min, className }) => (
  <div className={cn('flex items-center gap-1', className)}>
    <button
      type="button"
      onClick={() => onChange(shiftMonth(month, -1))}
      disabled={Boolean(min && shiftMonth(month, -1) < min)}
      aria-label="Previous month"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 disabled:opacity-30"
    >
      <ChevronLeft className="h-4 w-4" />
    </button>
    <p className="min-w-[9.5rem] text-center text-sm font-bold text-ink-900" aria-live="polite">
      {monthLabel(month)}
    </p>
    <button
      type="button"
      onClick={() => onChange(shiftMonth(month, 1))}
      aria-label="Next month"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
    >
      <ChevronRight className="h-4 w-4" />
    </button>
  </div>
)

export const WeekdayHeader: React.FC<{ short?: boolean }> = ({ short }) => (
  <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-500" aria-hidden>
    {WEEKDAYS.map((d) => (
      <div key={d} className="py-1.5">
        {short ? d.charAt(0) : d}
      </div>
    ))}
  </div>
)

export const StatusDot: React.FC<{ status: SlotStatus; className?: string }> = ({ status, className }) => (
  <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', SLOT_STATUS[status].dot, className)} aria-hidden />
)

export const Legend: React.FC<{ counts?: Partial<Record<SlotStatus, number>> }> = ({ counts }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
    {(Object.keys(SLOT_STATUS) as SlotStatus[]).map((s) => (
      <li key={s} className="inline-flex items-center gap-1.5">
        <StatusDot status={s} />
        {SLOT_STATUS[s].label}
        {counts && <span className="font-semibold tabular text-ink-900">{counts[s] ?? 0}</span>}
      </li>
    ))}
  </ul>
)

/** Space picker for venues; renders nothing for service profiles or venues without spaces. */
export const SpaceSelect: React.FC<{
  listing: ListingRef
  value: string
  onChange: (id: string) => void
  allLabel?: string
  className?: string
  label?: string
}> = ({ listing, value, onChange, allLabel = 'Whole venue', className, label = 'Space' }) => {
  if (listing.kind !== 'venue' || listing.spaces.length === 0) return null
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-sm font-medium text-ink-800">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-[10px] border border-ink-200 bg-white px-3 py-2 pr-8 text-sm text-ink-900 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <option value="">{allLabel}</option>
        {listing.spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
