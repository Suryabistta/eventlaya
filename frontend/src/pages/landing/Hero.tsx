import React from 'react'
import { Link } from 'react-router-dom'
import { UserPlus, ArrowRight, ScanLine, Ticket, Vote } from 'lucide-react'
import { buttonClass } from '@/components/ui/Button'
import { useHomeContent } from '@/lib/home-content'

const POINT_ICONS = [UserPlus, Ticket, ScanLine, Vote]

/** Slim strip under the search hero: what Eventlaya does for organizers, in one line, with the sign-up button.
 *  (It used to be a second full hero; the product tour lower down shows the product.) Content: home editor → "flow". */
export const Hero: React.FC = () => {
  const { flow } = useHomeContent()
  if (!flow.show) return null
  const points = flow.points.filter(Boolean).slice(0, 4)
  return (
    <section className="border-b border-ink-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">{flow.eyebrow}</p>
          <h2 className="mt-1 font-display text-lg font-bold leading-snug text-ink-900 sm:text-xl">{flow.title}</h2>
        </div>
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
          {points.map((label, i) => {
            const Icon = POINT_ICONS[i] ?? Vote
            return (
              <li key={label} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-ink-800">
                <Icon className="h-4 w-4 text-brand-600" aria-hidden />
                {label}
              </li>
            )
          })}
        </ul>
        <Link to="/signup" className={buttonClass('primary', 'md', 'group shrink-0 self-start rounded-full lg:self-auto')}>
          {flow.cta_label}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>
    </section>
  )
}
