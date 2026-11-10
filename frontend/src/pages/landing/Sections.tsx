import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { CONTACT_EMAIL } from '@/lib/legal'
import { Reveal } from './ProductTour'

const ease = [0.22, 1, 0.36, 1] as const

const faqs = [
  { q: 'Do attendees need to install an app?', a: 'No. They register on a web page and get their pass on screen and by email. Only your gate crew can optionally use the Android scanner app; any phone browser works too.' },
  { q: 'What happens if the internet drops at the gate?', a: 'The Android scanner keeps scanning and queues check-ins on the phone, then syncs them when the signal returns.' },
  { q: 'Can the same pass be used twice?', a: 'No. A second gate-in with the same pass is flagged as a duplicate straight away, on every gate.' },
  { q: 'How do people pay for tickets?', a: 'Online with Khalti or eSewa when you turn it on, or at the venue. Your plan is paid by eSewa, Khalti, Fonepay or bank transfer.' },
  { q: 'Can we use our own domain and logo?', a: 'Yes. Request white-label from Branding and domain; once approved, registration runs on your domain with your colours.' },
]

export const Faq: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="bg-ink-50 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">Questions organizers ask</h2>
          <p className="mt-4 text-lg text-ink-600">Something else? Write to {CONTACT_EMAIL}.</p>
        </Reveal>
        <ul className="divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white">
          {faqs.map((f, i) => {
            const isOpen = open === i
            return (
              <li key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
                >
                  <span className="font-semibold text-ink-900">{f.q}</span>
                  <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-brand-600">
                    <Plus className="h-5 w-5" aria-hidden />
                  </motion.span>
                </button>
                <motion.div
                  id={`faq-${i}`}
                  initial={false}
                  animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-5 leading-relaxed text-ink-600 sm:px-6">{f.a}</p>
                </motion.div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
