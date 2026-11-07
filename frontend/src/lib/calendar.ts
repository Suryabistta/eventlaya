import { useSyncExternalStore } from 'react'
import NepaliDate from 'nepali-date-converter'

/**
 * Bikram Sambat (BS) or Gregorian (AD) display for availability dates. Dates are still stored and sent
 * as AD ISO strings; only what people read changes. The choice is per viewer (browser storage), BS by default.
 */
export type CalendarSystem = 'bs' | 'ad'

const KEY = 'eventlaya:calendar'
const listeners = new Set<() => void>()

function read(): CalendarSystem {
  try {
    return localStorage.getItem(KEY) === 'ad' ? 'ad' : 'bs'
  } catch {
    return 'bs'
  }
}

let current: CalendarSystem = read()

export const calendarSystem = () => current

export function setCalendarSystem(value: CalendarSystem) {
  current = value
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // Private mode / blocked storage: the choice lasts until reload
  }
  listeners.forEach((l) => l())
}

/** Re-renders the caller when the viewer switches between BS and AD. */
export function useCalendarSystem(): [CalendarSystem, (v: CalendarSystem) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    calendarSystem,
    calendarSystem,
  )
  return [value, setCalendarSystem]
}

export const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra']

/** BS year, month (0-11) and day for a local Date; null outside the converter's range. */
export function toBs(date: Date): { year: number; month: number; day: number } | null {
  try {
    const n = new NepaliDate(date)
    return { year: n.getYear(), month: n.getMonth(), day: n.getDate() }
  } catch {
    return null
  }
}
