import React, { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ModernQr } from '@/components/ModernQr'

const ease = [0.22, 1, 0.36, 1] as const

/**
 * The signature moment: a pass arrives, the QR is scanned, the "Checked in" stamp lands
 * and the venue counter ticks up. Used in the hero and on the sign-in page.
 */
export const GatePassDemo: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const reduce = useReducedMotion()
  const [inside, setInside] = useState(311)

  useEffect(() => {
    const t = setTimeout(() => setInside(312), reduce ? 0 : 2300)
    return () => clearTimeout(t)
  }, [reduce])

  return (
    <div className="relative px-2 py-6" role="img" aria-label="An attendee pass being scanned and checked in at the gate">
      {/* Venue counter */}
      {!compact && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5, ease }}
          className="absolute -right-1 top-0 z-0 hidden rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-xs sm:block"
        >
          <p className="text-xs font-medium text-ink-500">Inside the venue</p>
          <p className="font-display text-2xl font-bold tabular text-ink-900">
            <motion.span key={inside} initial={{ y: reduce ? 0 : 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block">
              {inside}
            </motion.span>{' '}
            <span className="text-sm font-medium text-ink-400">/ 500</span>
          </p>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 40, rotate: -8 }}
        animate={{ opacity: 1, y: 0, rotate: -2 }}
        transition={{ duration: 0.9, ease }}
        className="relative z-10 mt-10 drop-shadow-[0_18px_32px_rgba(28,23,36,0.18)]"
      >
        <motion.div
          animate={reduce ? undefined : { y: [0, -6, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 2.8 }}
        >
          <div className="ticket-notch flex overflow-hidden rounded-2xl bg-white text-ink-900 ring-1 ring-ink-200" style={{ ['--notch-y' as string]: '50%' }}>
            <div className="min-w-0 flex-1 p-5 sm:p-6">
              <p className="text-xs font-semibold text-brand-700">Eastern Tech Fest &amp; Hackathon 2026</p>
              <p className="mt-3 font-display text-2xl font-bold leading-tight">Aarati Rai</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-500">Date</dt>
                  <dd className="font-semibold">27 Oct, 9:00</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Gate</dt>
                  <dd className="font-semibold">Main gate A</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-ink-500">Venue</dt>
                  <dd className="font-semibold">Purwanchal Campus Auditorium, Dharan</dd>
                </div>
              </dl>
              <p className="mt-5 font-mono text-xs text-ink-500">TKT-ETF26-0312</p>
            </div>
            <div className="w-px shrink-0 border-l-2 border-dashed border-ink-200" aria-hidden />
            <div className="relative flex w-[132px] shrink-0 flex-col items-center justify-center gap-2 bg-brand-600 p-4 sm:w-[148px]">
              <div className="relative overflow-hidden rounded-lg bg-white p-2">
                <ModernQr value="eventlaya:TKT-ETF26-0312" size={92} level="M" color="#1C1724" margin={1} />
                {!reduce && (
                  <motion.span
                    className="absolute inset-x-0 h-0.5 bg-marigold-400 shadow-[0_0_12px_2px] shadow-marigold-400/70"
                    initial={{ top: '0%', opacity: 0 }}
                    animate={{ top: ['0%', '100%', '0%'], opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 1.1, delay: 1, ease: 'easeInOut' }}
                    aria-hidden
                  />
                )}
              </div>
              <p className="text-xs font-medium text-brand-50">Show at the gate</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 1.9, rotate: -16 }}
          animate={{ opacity: 1, scale: 1, rotate: -10 }}
          transition={{ delay: reduce ? 0 : 2.1, type: 'spring', stiffness: 420, damping: 16 }}
          className="pointer-events-none absolute -bottom-6 right-[140px] rounded-lg border-[3px] border-emerald-500 bg-white/95 px-3 py-1.5 text-emerald-700 shadow-xs sm:right-[170px]"
        >
          <p className="font-display text-lg font-extrabold leading-none">Checked in</p>
          <p className="mt-0.5 font-mono text-[11px] font-medium">09:42, Gate A</p>
        </motion.div>
      </motion.div>
    </div>
  )
}
