import React from 'react'
import { useCalendarSystem } from '@/lib/calendar'
import { cn } from '@/lib/utils'

/** BS / AD switch for availability dates; the choice is remembered on this device. */
export const CalendarToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [system, setSystem] = useCalendarSystem()
  return (
    <div role="radiogroup" aria-label="Calendar" className={cn('inline-flex shrink-0 rounded-lg bg-ink-100 p-0.5', className)}>
      {(
        [
          ['bs', 'BS', 'Bikram Sambat (Nepali calendar)'],
          ['ad', 'AD', 'Gregorian calendar'],
        ] as const
      ).map(([value, label, title]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={system === value}
          title={title}
          onClick={() => setSystem(value)}
          className={cn('h-7 rounded-md px-2.5 text-xs font-semibold transition-colors', system === value ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
