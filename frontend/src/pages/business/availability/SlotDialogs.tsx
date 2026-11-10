import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarX, Repeat, X } from 'lucide-react'
import { isApiError, request } from '@/services/api'
import {
  addDays,
  apiErrorText,
  apiWeekday,
  fmtDay,
  fmtPrice,
  slotsApi,
  todayIso,
  WEEKDAYS,
  type BlockResult,
  type BulkResult,
  type Slot,
} from '@/lib/availability'
import { Button, Input, Modal, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { MonthNav, SpaceSelect, WeekdayHeader, monthGrid, monthOf, toTarget, type ListingRef, type SlotPreset } from './shared'

const invalidateSlots = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['my-slots'] })

/* ------------------------------------------------------------------ Times */

interface TimesValue {
  fullDay: boolean
  start: string
  end: string
}

const TimesFields: React.FC<{ value: TimesValue; onChange: (v: TimesValue) => void; presets?: SlotPreset[] }> = ({ value, onChange, presets = [] }) => (
  <fieldset className="space-y-3">
    <legend className="mb-1.5 block text-sm font-medium text-ink-800">Time</legend>
    {presets.length > 0 && (
      // The owner's saved slots: one tap fills the hours
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const on = !value.fullDay && value.start === p.start && value.end === p.end
          return (
            <button
              key={p.name}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ fullDay: false, start: p.start, end: p.end })}
              className={cn('h-8 rounded-full border px-3 text-sm font-semibold', on ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-700 hover:border-ink-400')}
            >
              {p.name} · {p.start}–{p.end}
            </button>
          )
        })}
      </div>
    )}
    <div className="inline-flex rounded-xl bg-ink-100 p-1" role="radiogroup" aria-label="Slot length">
      {(
        [
          [true, 'Full day'],
          [false, 'Set hours'],
        ] as const
      ).map(([full, label]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value.fullDay === full}
          onClick={() => onChange({ ...value, fullDay: full })}
          className={cn(
            'h-8 rounded-lg px-3.5 text-sm font-semibold transition-colors',
            value.fullDay === full ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {label}
        </button>
      ))}
    </div>
    {!value.fullDay && (
      <div className="grid grid-cols-2 gap-3">
        <Input label="Starts" type="time" required value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
        <Input label="Ends" type="time" required value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} hint="Same day" />
      </div>
    )}
  </fieldset>
)

const timesError = (t: TimesValue) => (!t.fullDay && t.start && t.end && t.end <= t.start ? 'End time must be after the start time.' : null)
const timesBody = (t: TimesValue) => (t.fullDay ? { start_time: null, end_time: null } : { start_time: t.start, end_time: t.end })

const PriceNote: React.FC<{
  price: string
  note: string
  onPrice: (v: string) => void
  onNote: (v: string) => void
  priceHint?: string
}> = ({ price, note, onPrice, onNote, priceHint }) => (
  <>
    <Input
      label="Price (Rs)"
      type="number"
      min={0}
      step="1"
      inputMode="numeric"
      value={price}
      onChange={(e) => onPrice(e.target.value)}
      placeholder="Your usual price"
      hint={priceHint ?? 'Optional. Leave empty to show your listing’s price.'}
    />
    <Textarea
      label="Note"
      rows={2}
      maxLength={255}
      value={note}
      onChange={(e) => onNote(e.target.value)}
      placeholder="Includes stage and basic sound"
      hint="Optional. Customers see it on open slots."
    />
  </>
)

/* ------------------------------------------------------------------ Add / edit one slot */

export const SlotFormModal: React.FC<{
  open: boolean
  onClose: () => void
  listing: ListingRef
  /** Editing this slot; otherwise a new one. */
  slot?: Slot | null
  date?: string
  space?: string
}> = ({ open, onClose, listing, slot, date, space }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const editing = Boolean(slot)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ date: '', space: '', price: '', note: '', blocked: false })
  const [times, setTimes] = useState<TimesValue>({ fullDay: true, start: '10:00', end: '16:00' })

  useEffect(() => {
    if (!open) return
    setForm({
      date: slot?.date ?? date ?? todayIso(),
      space: slot?.space ?? space ?? '',
      price: slot?.price ? String(Number(slot.price)) : '',
      note: slot?.note ?? '',
      blocked: slot?.status === 'blocked',
    })
    setTimes({ fullDay: slot ? slot.is_full_day : true, start: slot?.start_time ?? '10:00', end: slot?.end_time ?? '16:00' })
  }, [open, slot, date, space])

  const err = timesError(times)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (err) return
    setSaving(true)
    const body = {
      date: form.date,
      ...timesBody(times),
      price: form.price === '' ? null : form.price,
      note: form.note.trim(),
      status: form.blocked ? ('blocked' as const) : ('open' as const),
    }
    try {
      if (slot) await slotsApi.update(slot.id, body)
      else await slotsApi.create(toTarget(listing, form.space), body)
      toast.success(editing ? 'Slot updated' : form.blocked ? 'Day blocked' : 'Slot added', `${fmtDay(form.date)} on ${listing.name}.`)
      onClose()
    } catch (error) {
      if (isApiError(error, 'slot_locked')) {
        toast.error('A customer just requested this slot', 'Slots with a booking request can’t be changed. Decline the request first.')
        onClose()
      } else toast.error(editing ? 'Couldn’t update the slot' : 'Couldn’t add the slot', apiErrorText(error))
    } finally {
      setSaving(false)
      void invalidateSlots(qc)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit slot' : 'Add a slot'}
      description={listing.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="slot-form" loading={saving} disabled={Boolean(err)}>
            {editing ? 'Save slot' : 'Add slot'}
          </Button>
        </>
      }
    >
      <form id="slot-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Date" type="date" required min={editing ? undefined : todayIso()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          {editing ? (
            listing.kind === 'venue' && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-800">Space</p>
                <p className="py-2 text-sm text-ink-700">{slot?.space_name || 'Whole venue'}</p>
              </div>
            )
          ) : (
            <SpaceSelect listing={listing} value={form.space} onChange={(v) => setForm((f) => ({ ...f, space: v }))} />
          )}
        </div>
        <TimesFields value={times} onChange={setTimes} presets={listing.presets} />
        {err && <p className="text-xs font-medium text-red-600">{err}</p>}
        <PriceNote
          price={form.price}
          note={form.note}
          onPrice={(v) => setForm((f) => ({ ...f, price: v }))}
          onNote={(v) => setForm((f) => ({ ...f, note: v }))}
          priceHint={slot && !slot.price && slot.effective_price ? `Optional. Empty shows your listing price (${fmtPrice(slot.effective_price)}).` : undefined}
        />
        <label className="flex items-start gap-2.5 rounded-xl border border-ink-200 px-3.5 py-3 text-sm">
          <input
            type="checkbox"
            checked={form.blocked}
            onChange={(e) => setForm((f) => ({ ...f, blocked: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-brand-600"
          />
          <span>
            <span className="font-medium text-ink-900">Blocked</span>
            <span className="block text-ink-500">Closed for requests, for example a private booking you took by phone.</span>
          </span>
        </label>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Repeat slots */

export const RepeatSlotsModal: React.FC<{ open: boolean; onClose: () => void; listing: ListingRef; date?: string; space?: string }> = ({
  open,
  onClose,
  listing,
  date,
  space,
}) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [form, setForm] = useState({ start: '', end: '', space: '', price: '', note: '' })
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [times, setTimes] = useState<TimesValue>({ fullDay: true, start: '10:00', end: '16:00' })

  useEffect(() => {
    if (!open) return
    const start = date && date > todayIso() ? date : todayIso()
    setForm({ start, end: addDays(start, 27), space: space ?? '', price: '', note: '' })
    setWeekdays([0, 1, 2, 3, 4, 5, 6])
    setTimes({ fullDay: true, start: '10:00', end: '16:00' })
    setResult(null)
  }, [open, date, space])

  /** Days the request would cover (the server skips the ones that already have an overlapping slot). */
  const count = useMemo(() => {
    if (!form.start || !form.end || form.end < form.start) return 0
    let n = 0
    for (let d = form.start; d <= form.end && n <= 1000; d = addDays(d, 1)) if (weekdays.includes(apiWeekday(d))) n += 1
    return n
  }, [form.start, form.end, weekdays])

  const err = timesError(times) ?? (form.end && form.start && form.end < form.start ? 'The end date is before the start date.' : null)
  const toggle = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (err || weekdays.length === 0) return
    setSaving(true)
    try {
      const res = await slotsApi.bulk(toTarget(listing, form.space), {
        start_date: form.start,
        end_date: form.end,
        weekdays,
        ...timesBody(times),
        price: form.price === '' ? null : form.price,
        note: form.note.trim(),
      })
      setResult(res)
      toast.success(`Created ${res.created} slot${res.created === 1 ? '' : 's'}`, res.skipped ? `Skipped ${res.skipped} that already had slots.` : undefined)
    } catch (error) {
      toast.error('Couldn’t create the slots', apiErrorText(error))
    } finally {
      setSaving(false)
      void invalidateSlots(qc)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Repeat slots"
      description={`Add the same slot on chosen weekdays, ${listing.name}`}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="repeat-form" loading={saving} disabled={Boolean(err) || count === 0} icon={<Repeat className="h-4 w-4" aria-hidden />}>
              Create {count > 0 ? `up to ${count}` : ''} slot{count === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div role="status" className="space-y-3">
          <p className="text-base font-semibold text-ink-900">
            Created {result.created}, skipped {result.skipped} (already had slots)
          </p>
          {result.skipped_dates.length > 0 && (
            <div>
              <p className="text-sm text-ink-600">These days already had an overlapping slot, so they were left as they were:</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {result.skipped_dates.slice(0, 30).map((d) => (
                  <li key={d} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
                    {fmtDay(d)}
                  </li>
                ))}
                {result.skipped_dates.length > 30 && <li className="text-xs text-ink-500">and {result.skipped_dates.length - 30} more</li>}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <form id="repeat-form" onSubmit={submit} className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink-800">On these days</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={weekdays.includes(i)}
                  onClick={() => toggle(i)}
                  className={cn(
                    'h-9 w-12 rounded-full border text-sm font-semibold transition-colors',
                    weekdays.includes(i) ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-3 text-xs font-medium">
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])}>
                Every day
              </button>
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setWeekdays([5, 6])}>
                Weekends
              </button>
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setWeekdays([0, 1, 2, 3, 4])}>
                Weekdays
              </button>
            </div>
            {weekdays.length === 0 && <p className="mt-1.5 text-xs font-medium text-red-600">Pick at least one day.</p>}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="From" type="date" required min={todayIso()} value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
            <Input label="Until" type="date" required min={form.start} value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
            <SpaceSelect listing={listing} value={form.space} onChange={(v) => setForm((f) => ({ ...f, space: v }))} />
          </div>
          <TimesFields value={times} onChange={setTimes} presets={listing.presets} />
          {err && <p className="text-xs font-medium text-red-600">{err}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <PriceNote price={form.price} note={form.note} onPrice={(v) => setForm((f) => ({ ...f, price: v }))} onNote={(v) => setForm((f) => ({ ...f, note: v }))} />
          </div>
          <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-600">
            {count > 500
              ? 'That’s more than 500 slots. Pick a shorter range or fewer days.'
              : `Up to ${count} slot${count === 1 ? '' : 's'}. Days that already have an overlapping slot are skipped.`}
          </p>
        </form>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ Block dates */

export const BlockDatesModal: React.FC<{
  open: boolean
  onClose: () => void
  listing: ListingRef
  date?: string
  space?: string
  /** Month the calendar is showing (YYYY-MM), so the picker opens there. */
  month?: string
}> = ({ open, onClose, listing, date, space, month: viewMonth }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const today = todayIso()
  const [saving, setSaving] = useState(false)
  const [dates, setDates] = useState<string[]>([])
  const [month, setMonth] = useState(monthOf(today))
  const [spaceId, setSpaceId] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<BlockResult | null>(null)

  useEffect(() => {
    if (!open) return
    const start = date && date >= today ? date : null
    setDates(start ? [start] : [])
    setMonth(start ? monthOf(start) : viewMonth && viewMonth > monthOf(today) ? viewMonth : monthOf(today))
    setSpaceId(space ?? '')
    setNote('')
    setResult(null)
  }, [open, date, space, today, viewMonth])

  const grid = monthGrid(month)
  const toggle = (d: string) => setDates((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d].sort()))

  const submit = async () => {
    if (dates.length === 0) return
    setSaving(true)
    try {
      const res = await slotsApi.block(toTarget(listing, spaceId), dates, note.trim())
      setResult(res)
      const closed = res.created + res.blocked
      toast.success(`Blocked ${closed} slot${closed === 1 ? '' : 's'}`, res.skipped.length ? `${res.skipped.length} skipped: they have booking requests.` : undefined)
    } catch (error) {
      toast.error('Couldn’t block those dates', apiErrorText(error))
    } finally {
      setSaving(false)
      void invalidateSlots(qc)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Block dates"
      description="Close whole days for requests. Open slots on those days are blocked too."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="dark" onClick={submit} loading={saving} disabled={dates.length === 0} icon={<CalendarX className="h-4 w-4" aria-hidden />}>
              Block {dates.length || ''} day{dates.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div role="status" className="space-y-3 text-sm">
          <p className="text-base font-semibold text-ink-900">
            {result.created} day{result.created === 1 ? '' : 's'} closed, {result.blocked} open slot{result.blocked === 1 ? '' : 's'} blocked
          </p>
          {result.skipped.length > 0 ? (
            <div>
              <p className="text-ink-600">Skipped because a customer has requested or booked them. Decline the request first to block these:</p>
              <ul className="mt-2 space-y-1">
                {result.skipped.map((s) => (
                  <li key={s.slot_id} className="flex items-center gap-2 text-ink-800">
                    <span className="h-2 w-2 rounded-full bg-marigold-500" aria-hidden />
                    {fmtDay(s.date, true)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-ink-600">Customers can’t request these days now. Unblock a day from its panel when it frees up.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-800">Pick days</p>
              <MonthNav month={month} onChange={setMonth} min={monthOf(today)} />
            </div>
            <WeekdayHeader short />
            <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days to block">
              {grid.days.map((d) => {
                const inMonth = d >= grid.first && d <= grid.last
                const past = d < today
                const on = dates.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={past || !inMonth}
                    aria-pressed={on}
                    aria-label={fmtDay(d, true)}
                    onClick={() => toggle(d)}
                    className={cn(
                      'h-10 rounded-lg text-sm font-semibold tabular transition-colors',
                      !inMonth && 'invisible',
                      past && 'text-ink-300',
                      on ? 'bg-ink-800 text-white' : !past && 'text-ink-800 hover:bg-ink-100',
                      d === today && !on && 'ring-1 ring-brand-300',
                    )}
                  >
                    {Number(d.slice(8))}
                  </button>
                )
              })}
            </div>
          </div>
          {dates.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Selected days">
              {dates.map((d) => (
                <li key={d}>
                  <button
                    type="button"
                    onClick={() => toggle(d)}
                    className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-ink-800 hover:bg-ink-200"
                  >
                    {fmtDay(d)}
                    <X className="h-3 w-3" aria-label="Remove" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SpaceSelect listing={listing} value={spaceId} onChange={setSpaceId} allLabel="Whole venue (every space)" />
          <Input label="Note" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="Family function" hint="Optional, only you see it." />
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ Delete */

export const DeleteSlotModal: React.FC<{ slot: Slot | null; onClose: () => void }> = ({ slot, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const remove = async () => {
    if (!slot) return
    setSaving(true)
    try {
      await slotsApi.remove(slot.id)
      toast.success('Slot deleted', fmtDay(slot.date))
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error, 'slot_locked') ? 'A customer has requested this slot' : 'Couldn’t delete the slot',
        isApiError(error, 'slot_locked') ? 'Decline the request first, then delete the slot.' : apiErrorText(error),
      )
      if (isApiError(error, 'slot_locked')) onClose()
    } finally {
      setSaving(false)
      void invalidateSlots(qc)
    }
  }
  return (
    <Modal
      open={Boolean(slot)}
      onClose={onClose}
      size="sm"
      title="Delete this slot?"
      description={slot ? fmtDay(slot.date, true) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" onClick={remove} loading={saving}>
            Delete slot
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">Customers won’t see it any more. To keep the day closed instead, block it.</p>
    </Modal>
  )
}

/** The listing's saved time slots (Morning 7–11, Evening 6–10…). Whole day stays the default when opening dates. */
export const PresetsModal: React.FC<{ listing: ListingRef; onClose: () => void }> = ({ listing, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [rows, setRows] = useState<SlotPreset[]>(listing.presets.length ? listing.presets : [{ name: 'Morning', start: '07:00', end: '11:00' }])
  const bad = rows.find((r) => !r.name.trim() || !r.start || !r.end || r.end <= r.start)
  const save = useMutation({
    mutationFn: () =>
      request(`/marketplace/${listing.kind === 'venue' ? 'venues' : 'vendors'}/${listing.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ slot_presets: rows.map((r) => ({ ...r, name: r.name.trim() })) }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries()
      toast.success('Time slots saved', 'Pick them when you add or repeat slots.')
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })
  const set = (i: number, patch: Partial<SlotPreset>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <Modal
      open
      onClose={onClose}
      title="Time slots"
      description={`Saved slots for ${listing.name}. Whole day is always available; these are one-tap choices when you open dates.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={Boolean(bad)} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_110px_auto] items-end gap-2">
            <Input label={i === 0 ? 'Name' : ''} aria-label="Slot name" maxLength={40} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <Input label={i === 0 ? 'Starts' : ''} aria-label="Starts" type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
            <Input label={i === 0 ? 'Ends' : ''} aria-label="Ends" type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} />
            <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`}>
              Remove
            </Button>
          </div>
        ))}
        {bad && <p className="text-sm text-red-600">Each slot needs a name and an end after its start.</p>}
        {rows.length < 8 && (
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { name: '', start: '18:00', end: '22:00' }])}>
            Add a time slot
          </Button>
        )}
      </div>
    </Modal>
  )
}
