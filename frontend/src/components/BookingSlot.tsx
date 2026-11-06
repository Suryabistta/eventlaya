import React from 'react'
import { CalendarClock } from 'lucide-react'
import { fmtDay, fmtPrice, slotTime, type InquirySlot } from '@/lib/availability'
import { cn } from '@/lib/utils'

/** "Sat, 14 Nov · Full day · Main hall" */
export const slotSummaryText = (slot: Pick<InquirySlot, 'date' | 'start_time' | 'end_time' | 'space_name'>) =>
  [fmtDay(slot.date), slotTime(slot), slot.space_name].filter(Boolean).join(' · ')

/** The availability slot a booking request is for: date, time, space and price. */
export const BookingSlotBox: React.FC<{ slot: Pick<InquirySlot, 'date' | 'start_time' | 'end_time' | 'space_name' | 'price'>; label?: string; className?: string; children?: React.ReactNode }> = ({
  slot,
  label = 'Requested slot',
  className,
  children,
}) => {
  const price = fmtPrice(slot.price)
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/50 px-3.5 py-2.5', className)}>
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{label}</p>
        <p className="font-semibold text-ink-900">{fmtDay(slot.date, true)}</p>
        <p className="text-ink-700">
          {slotTime(slot)}
          {slot.space_name && <span> · {slot.space_name}</span>}
          {price && (
            <span>
              {' '}
              · <span className="font-medium tabular">{price}</span>
            </span>
          )}
        </p>
        {children}
      </div>
    </div>
  )
}
