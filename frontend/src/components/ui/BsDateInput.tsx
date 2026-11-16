import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import NepaliDate from 'nepali-date-converter'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { BS_MONTHS, setCalendarSystem, toBs } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { controlClass } from './Field'

/**
 * Nepali (Bikram Sambat) picker standing in for <input type="date"> and <input type="datetime-local"> when the
 * viewer reads BS. Same value in and out as the native input (AD "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"), so forms
 * and the API don't change; only what people see and pick is BS.
 */
type Props = {
  id?: string
  type: 'date' | 'datetime-local'
  value?: string
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  className?: string
  name?: string
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')
const adIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** AD Date for a BS day; null outside the converter's range */
function bsToDate(year: number, month: number, day: number): Date | null {
  try {
    return new NepaliDate(year, month, day).toJsDate()
  } catch {
    return null
  }
}

function daysInBsMonth(year: number, month: number): number {
  for (let d = 32; d >= 28; d--) {
    const js = bsToDate(year, month, d)
    if (js && toBs(js)?.month === month) return d
  }
  return 30
}

function parseValue(value: string | undefined) {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  const [hh, mm] = (timePart ?? '').split(':').map(Number)
  return { date: new Date(y, m - 1, d), hour: Number.isFinite(hh) ? hh : null, minute: Number.isFinite(mm) ? mm : null }
}

export const BsDateInput: React.FC<Props> = ({ id, type, value, min, max, required, disabled, className, name, onChange, ...aria }) => {
  const withTime = type === 'datetime-local'
  const parsed = parseValue(value)
  const picked = parsed ? toBs(parsed.date) : null
  const hour = parsed?.hour ?? 10
  const minute = parsed?.minute ?? 0

  const [open, setOpen] = useState(false)
  const today = toBs(new Date())
  const [view, setView] = useState(() => ({ year: (picked ?? today)?.year ?? 2083, month: (picked ?? today)?.month ?? 0 }))
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // Fixed position on <body>: a modal's scroll area would otherwise clip the calendar
  const [pos, setPos] = useState<{ left: number; top: number; inDialog: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const place = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const h = pop.current?.offsetHeight ?? 380
      const w = pop.current?.offsetWidth ?? 296
      const below = window.innerHeight - r.bottom
      const top = below >= h + 8 || r.top < h + 8 ? r.bottom + 4 : r.top - h - 4
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
      // Inside a <dialog> (top layer) the calendar is placed in it, so offset by the dialog's own box
      const host = box.current?.closest('dialog')?.getBoundingClientRect()
      setPos({ left: left - (host?.left ?? 0), top: Math.max(8, top) - (host?.top ?? 0), inDialog: Boolean(host) })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (picked) setView({ year: picked.year, month: picked.month })
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const emit = (next: string) => {
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } } as unknown as React.ChangeEvent<HTMLInputElement>)
  }
  const emitDate = (d: Date, h = hour, m = minute) => emit(withTime ? `${adIso(d)}T${pad(h)}:${pad(m)}` : adIso(d))

  const minDay = min?.slice(0, 10)
  const maxDay = max?.slice(0, 10)
  const outOfRange = (iso: string) => Boolean((minDay && iso < minDay) || (maxDay && iso > maxDay))

  const first = bsToDate(view.year, view.month, 1)
  const count = daysInBsMonth(view.year, view.month)
  const lead = first ? first.getDay() : 0
  const step = (delta: number) =>
    setView((v) => {
      const m = v.month + delta
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
    })

  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const pm = hour >= 12
  const setTime = (h: number, m: number) => parsed && emitDate(parsed.date, h, m)

  const label = picked
    ? `${picked.day} ${BS_MONTHS[picked.month]} ${picked.year}${withTime && parsed?.hour != null ? `, ${h12}:${pad(minute)} ${pm ? 'PM' : 'AM'}` : ''}`
    : ''

  return (
    <div ref={box} className="relative">
      <button
        id={id}
        type="button"
        name={name}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required}
        {...aria}
        onClick={() => setOpen((o) => !o)}
        className={cn(controlClass, 'flex items-center justify-between gap-2 text-left', className)}
      >
        <span className={label ? '' : 'text-ink-400'}>{label || (withTime ? 'Pick a date and time (BS)' : 'Pick a date (BS)')}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
      </button>

      {open && createPortal(
        <div
          ref={pop}
          role="dialog"
          aria-label="Choose a date"
          style={{ position: pos?.inDialog ? 'absolute' : 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          className="z-[1000] w-[18.5rem] rounded-xl border border-ink-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => step(-1)} className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-ink-900">
              {BS_MONTHS[view.month]} {view.year}
            </span>
            <button type="button" onClick={() => step(1)} className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[11px] font-medium text-ink-500">
                {w}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const day = i + 1
              const js = bsToDate(view.year, view.month, day)
              const iso = js ? adIso(js) : ''
              const selected = picked && picked.year === view.year && picked.month === view.month && picked.day === day
              const isToday = today && today.year === view.year && today.month === view.month && today.day === day
              const off = !js || outOfRange(iso)
              return (
                <button
                  key={day}
                  type="button"
                  disabled={off}
                  onClick={() => {
                    if (!js) return
                    emitDate(js)
                    if (!withTime) setOpen(false)
                  }}
                  className={cn(
                    'h-8 rounded-md text-sm tabular-nums transition-colors',
                    selected ? 'bg-brand-600 font-semibold text-white' : 'text-ink-800 hover:bg-ink-100',
                    isToday && !selected && 'ring-1 ring-brand-400',
                    off && 'cursor-not-allowed text-ink-300 hover:bg-transparent',
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {withTime && (
            <div className="mt-3 flex items-center gap-2 border-t border-ink-100 pt-3">
              <span className="text-xs font-medium text-ink-600">Time</span>
              <select
                aria-label="Hour"
                disabled={!parsed}
                value={h12}
                onChange={(e) => setTime((Number(e.target.value) % 12) + (pm ? 12 : 0), minute)}
                className="h-8 rounded-md border border-ink-200 px-1.5 text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-ink-500">:</span>
              <select
                aria-label="Minute"
                disabled={!parsed}
                value={minute}
                onChange={(e) => setTime(hour, Number(e.target.value))}
                className="h-8 rounded-md border border-ink-200 px-1.5 text-sm"
              >
                {Array.from({ length: 60 }, (_, m) => m).map((m) => (
                  <option key={m} value={m}>
                    {pad(m)}
                  </option>
                ))}
              </select>
              <select
                aria-label="AM or PM"
                disabled={!parsed}
                value={pm ? 'PM' : 'AM'}
                onChange={(e) => setTime((hour % 12) + (e.target.value === 'PM' ? 12 : 0), minute)}
                className="h-8 rounded-md border border-ink-200 px-1.5 text-sm"
              >
                <option>AM</option>
                <option>PM</option>
              </select>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="flex gap-3">
              {!required && value && (
                <button type="button" onClick={() => emit('')} className="font-medium text-ink-600 hover:text-ink-900">
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setCalendarSystem('ad')} className="font-medium text-ink-600 hover:text-ink-900">
                Use AD calendar
              </button>
            </div>
            <div className="flex gap-3">
              {today && !outOfRange(adIso(new Date())) && (
                <button
                  type="button"
                  onClick={() => {
                    emitDate(new Date())
                    if (!withTime) setOpen(false)
                  }}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Today
                </button>
              )}
              {withTime && (
                <button type="button" onClick={() => setOpen(false)} className="font-semibold text-brand-700 hover:underline">
                  Done
                </button>
              )}
            </div>
          </div>
        </div>,
        box.current?.closest('dialog') ?? document.body,
      )}
    </div>
  )
}
