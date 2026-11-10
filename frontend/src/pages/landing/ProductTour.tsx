import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { FileText, QrCode, ScanLine, BarChart3, Check, CheckCircle2 } from 'lucide-react'
import { ModernQr } from '@/components/ModernQr'
import { cn } from '@/lib/utils'

const ease = [0.22, 1, 0.36, 1] as const
const DURATION = 6000

const tabs = [
  { id: 'form', label: 'Registration form', icon: FileText, title: 'Ask exactly what you need', body: 'Build the form in minutes: text, dropdowns, choices, phone and email. Share one link on Facebook, WhatsApp or your college group.' },
  { id: 'pass', label: 'QR pass', icon: QrCode, title: 'Every sign-up gets a pass', body: 'No approval queue. The pass appears on screen and in their inbox, works on any phone, and prints cleanly.' },
  { id: 'scan', label: 'Gate scanner', icon: ScanLine, title: 'Any phone scans at the gate', body: 'Staff are assigned to a gate. Duplicates are stopped on the spot and exit-only gates refuse check-ins.' },
  { id: 'live', label: 'Live dashboard', icon: BarChart3, title: 'Know who is inside, right now', body: 'Registrations, arrivals by hour, occupancy against capacity and crew tasks, updated every few seconds.' },
] as const

type TabId = (typeof tabs)[number]['id']

export const ProductTour: React.FC = () => {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4 })
  const [active, setActive] = useState<TabId>('form')
  const [paused, setPaused] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const auto = inView && !paused && !reduce

  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => {
      const i = tabs.findIndex((t) => t.id === active)
      setActive(tabs[(i + 1) % tabs.length].id)
      setProgressKey((k) => k + 1)
    }, DURATION)
    return () => clearTimeout(t)
  }, [active, auto, progressKey])

  const tab = tabs.find((t) => t.id === active)!

  return (
    <section id="dashboard" className="scroll-mt-20 bg-[#241a22] bg-[radial-gradient(ellipse_at_85%_60%,rgba(194,33,90,0.35),transparent_55%)] py-20 sm:py-28">
      <div ref={ref} className="mx-auto max-w-6xl px-4 sm:px-6" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="flex items-center justify-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-brand-300">
            <span className="h-px w-6 bg-brand-300" aria-hidden />
            Organizer dashboard
          </p>
          <h2 className="mt-3 font-display text-3xl font-extrabold text-white sm:text-[44px] sm:leading-[1.08]">Run the whole event from one dashboard</h2>
          <p className="mt-4 text-lg text-white/70">Four screens your team actually uses on event day.</p>
        </Reveal>

        <div role="tablist" aria-label="Product tour" className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tabs.map((t) => {
            const selected = t.id === active
            return (
              <button
                key={t.id}
                role="tab"
                id={`tour-tab-${t.id}`}
                aria-selected={selected}
                aria-controls="tour-panel"
                onClick={() => {
                  setActive(t.id)
                  setProgressKey((k) => k + 1)
                }}
                className={cn(
                  'relative overflow-hidden rounded-xl border p-3 text-left transition-colors sm:p-4',
                  selected ? 'border-brand-200 bg-white shadow-xs' : 'border-white/15 bg-white/5 hover:bg-white/10',
                )}
              >
                <span className={cn('flex items-center gap-2 text-sm font-semibold', selected ? 'text-ink-900' : 'text-white')}>
                  <t.icon className={cn('h-4 w-4', selected ? 'text-brand-600' : 'text-white/60')} aria-hidden />
                  {t.label}
                </span>
                {selected && (
                  <motion.span
                    key={progressKey}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand-600"
                    initial={{ scaleX: auto ? 0 : 1 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: auto ? DURATION / 1000 : 0, ease: 'linear' }}
                  />
                )}
              </button>
            )
          })}
        </div>

        <div
          id="tour-panel"
          role="tabpanel"
          aria-labelledby={`tour-tab-${active}`}
          className="mt-6 grid items-center gap-8 rounded-3xl border border-ink-200 bg-white p-5 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12 lg:p-10"
        >
          <AnimatePresence mode="wait">
            <motion.div key={tab.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease }}>
              <h3 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">{tab.title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-ink-600">{tab.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-ink-100 bg-ink-50 p-4 sm:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab.id}
                initial={{ opacity: 0, scale: 0.97, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -10 }}
                transition={{ duration: 0.45, ease }}
                aria-hidden
              >
                {tab.id === 'form' && <FormMock />}
                {tab.id === 'pass' && <PassMock />}
                {tab.id === 'scan' && <ScanMock />}
                {tab.id === 'live' && <LiveMock />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------- Mock screens ---------------- */

const Field: React.FC<{ label: string; value: string; delay: number }> = ({ label, value, delay }) => (
  <div>
    <p className="text-xs font-medium text-ink-600">{label}</p>
    <div className="mt-1 flex h-9 items-center overflow-hidden rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900">
      <motion.span initial={{ width: 0 }} animate={{ width: 'auto' }} transition={{ delay, duration: 0.6, ease: 'easeOut' }} className="overflow-hidden whitespace-nowrap">
        {value}
      </motion.span>
    </div>
  </div>
)

const FormMock: React.FC = () => (
  <div className="mx-auto max-w-sm rounded-xl bg-white p-5 shadow-xs">
    <p className="font-display text-lg font-bold text-ink-900">Register</p>
    <p className="text-xs text-ink-500">Eastern Tech Fest &amp; Hackathon 2026</p>
    <div className="mt-4 space-y-3">
      <Field label="Full name" value="Sita Rai" delay={0.2} />
      <Field label="College" value="Purwanchal Campus" delay={0.7} />
      <div>
        <p className="text-xs font-medium text-ink-600">Hackathon track</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {['AI & ML', 'Web', 'Robotics'].map((t, i) => (
            <motion.span
              key={t}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 + i * 0.1 }}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', i === 0 ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 text-ink-700')}
            >
              {t}
            </motion.span>
          ))}
        </div>
      </div>
      <motion.div initial={{ scale: 0.98 }} animate={{ scale: [1, 0.97, 1] }} transition={{ delay: 1.8, duration: 0.3 }} className="flex h-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white">
        Register
      </motion.div>
    </div>
  </div>
)

const PassMock: React.FC = () => (
  <div className="mx-auto max-w-sm">
    <div className="ticket-notch flex overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200" style={{ ['--notch-y' as string]: '50%' }}>
      <div className="flex-1 p-5">
        <p className="text-xs font-semibold text-brand-700">Eastern Tech Fest</p>
        <p className="mt-2 font-display text-xl font-bold text-ink-900">Sita Rai</p>
        <p className="mt-3 font-mono text-xs text-ink-500">TKT-ETF26-0313</p>
        <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Emailed to sita@gmail.com
        </motion.p>
      </div>
      <div className="w-px border-l-2 border-dashed border-ink-200" />
      <div className="flex w-32 items-center justify-center bg-brand-600 p-3">
        <motion.div initial={{ rotate: -8, scale: 0.8, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.2 }} className="rounded-lg bg-white p-2">
          <ModernQr value="eventlaya:TKT-ETF26-0313" size={80} color="#1C1724" margin={1} />
        </motion.div>
      </div>
    </div>
  </div>
)

const ScanMock: React.FC = () => (
  <div className="mx-auto max-w-xs space-y-3">
    <div className="flex rounded-xl bg-white p-1 shadow-2xs">
      <span className="flex-1 rounded-lg bg-emerald-600 py-2 text-center text-sm font-semibold text-white">Gate in</span>
      <span className="flex-1 py-2 text-center text-sm font-semibold text-ink-500">Gate out</span>
    </div>
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-ink-200 bg-ink-100">
      <div className="absolute inset-8 rounded-lg border-2 border-white/90" />
      <motion.span className="absolute inset-x-8 h-0.5 bg-brand-500 shadow-[0_0_10px_2px] shadow-brand-500/60" initial={{ top: '20%' }} animate={{ top: ['20%', '80%', '20%'] }} transition={{ duration: 1.6, repeat: 1, ease: 'easeInOut' }} />
    </div>
    <motion.div initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 1.6, duration: 0.35, ease }} className="flex items-center gap-3 rounded-xl bg-emerald-600 p-3.5 text-white">
      <CheckCircle2 className="h-8 w-8 shrink-0" />
      <div>
        <p className="font-display text-lg font-bold leading-tight">Let them in</p>
        <p className="text-sm text-emerald-50">Sita Rai, Main gate A</p>
      </div>
    </motion.div>
  </div>
)

const LiveMock: React.FC = () => {
  const bars = [3, 8, 14, 22, 30, 18, 9]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Registered', '486'],
          ['Inside now', '271'],
          ['Check-in rate', '64%'],
        ].map(([l, v], i) => (
          <motion.div key={l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }} className="rounded-xl bg-white p-3 shadow-2xs">
            <p className="text-[11px] text-ink-500">{l}</p>
            <p className="font-display text-xl font-bold tabular text-ink-900">{v}</p>
          </motion.div>
        ))}
      </div>
      <div className="rounded-xl bg-white p-4 shadow-2xs">
        <p className="text-xs font-medium text-ink-600">Arrivals by hour</p>
        <div className="mt-3 flex h-32 items-end gap-2">
          {bars.map((b, i) => (
            <motion.div
              key={i}
              className="flex-1 rounded-t-[4px] bg-brand-600"
              initial={{ height: 0 }}
              animate={{ height: `${(b / 30) * 100}%` }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.6, ease }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-ink-400">
          <span>8 AM</span>
          <span>11 AM</span>
          <span>2 PM</span>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Shared reveal ---------------- */

export const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className, delay = 0 }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.3 }}
    transition={{ duration: 0.7, delay, ease }}
  >
    {children}
  </motion.div>
)
