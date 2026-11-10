import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { UserPlus, ArrowRight, ScanLine, Ticket, Vote } from 'lucide-react'
import { buttonClass } from '@/components/ui/Button'
import { GatePassDemo } from './GatePass'

const ease = [0.22, 1, 0.36, 1] as const
const headline = ['Registration,', 'ticketing', '&', 'check-in,', 'all', 'in', 'one', 'flow.']

const signups = [
  { name: 'Sita Rai', from: 'Dharan', ticket: 'TKT-0313' },
  { name: 'Bibek Limbu', from: 'Itahari', ticket: 'TKT-0314' },
  { name: 'Anjali Karki', from: 'Biratnagar', ticket: 'TKT-0315' },
  { name: 'Prakash Tamang', from: 'Dharan', ticket: 'TKT-0316' },
]

export const Hero: React.FC = () => {
  const reduce = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand-50/60 via-white to-white">
      {/* Dot grid, faded towards the edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(theme(colors.ink.300)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_70%_40%,#000_30%,transparent_75%)] opacity-60"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-28">
        <div className="max-w-xl">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-brand-600"
          >
            <span className="h-px w-6 bg-brand-600" aria-hidden />
            One platform. Every event.
          </motion.p>

          <h2 className="mt-5 font-display text-[38px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-5xl lg:text-[56px]">
            {headline.map((word, i) => (
              <motion.span
                key={word}
                className="inline-block"
                initial={{ opacity: 0, y: reduce ? 0 : 28, filter: reduce ? 'none' : 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, delay: 0.1 + i * 0.07, ease }}
              >
                {word}
                {i < headline.length - 1 && ' '}
              </motion.span>
            ))}
          </h2>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55, ease }}
            className="mt-6 max-w-lg text-lg leading-relaxed text-ink-600"
          >
            Let attendees register online, get a secure QR pass, scan in at the gate (even offline) and vote live from their
            phones.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link to="/signup" className={buttonClass('primary', 'lg', 'group rounded-full')}>
              Start your event
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a href="#dashboard" className={buttonClass('secondary', 'lg', 'rounded-full')}>
              See how it works
            </a>
          </motion.div>

          <ul className="mt-10 grid grid-cols-2 gap-4 border-t border-ink-200 pt-6 text-sm font-medium text-ink-700 sm:grid-cols-4">
            {[
              [UserPlus, 'Online registration'],
              [Ticket, 'Digital QR passes'],
              [ScanLine, 'Online / offline check-in'],
              [Vote, 'Live voting'],
            ].map(([Icon, label]) => (
              <li key={label as string} className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  {React.createElement(Icon as React.ElementType, { className: 'h-4 w-4', 'aria-hidden': true })}
                </span>
                {label as string}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:mr-0">
          <GatePassDemo />
          <SignupFeed />
          <GateMeter />
        </div>
      </div>
    </section>
  )
}

/** "Someone just registered" notifications, cycling. */
const SignupFeed: React.FC = () => {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setI((n) => (n + 1) % signups.length), 2800)
    return () => clearInterval(t)
  }, [reduce])
  const s = signups[i]
  return (
    <div className="absolute -left-2 top-0 z-20 hidden w-64 sm:block lg:-left-20" aria-hidden>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={s.ticket}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.98 }}
          transition={{ duration: 0.45, ease }}
          className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white/95 p-3 shadow-pop backdrop-blur"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <UserPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">{s.name} registered</p>
            <p className="truncate text-xs text-ink-500">
              From {s.from}, pass {s.ticket} sent
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Check-ins per gate, bars growing in. */
const GateMeter: React.FC = () => {
  const gates = [
    { name: 'Main gate', value: 0.82 },
    { name: 'VIP', value: 0.46 },
    { name: 'Exit B', value: 0.28 },
  ]
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 1.4, duration: 0.6, ease }}
      className="absolute -bottom-36 right-0 z-20 hidden w-48 rounded-xl border border-ink-200 bg-white p-3 shadow-pop sm:block xl:-right-10"
      aria-hidden
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <ScanLine className="h-3.5 w-3.5 text-brand-600" />
        Check-ins by gate
      </p>
      <ul className="mt-2 space-y-2">
        {gates.map((g, i) => (
          <li key={g.name}>
            <p className="text-[11px] text-ink-600">{g.name}</p>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <motion.div
                className="h-full rounded-full bg-brand-600"
                initial={{ width: 0 }}
                animate={{ width: `${g.value * 100}%` }}
                transition={{ delay: 1.7 + i * 0.15, duration: 0.9, ease }}
              />
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}
