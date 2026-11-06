import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CONTACT_EMAIL, LAST_UPDATED, LEGAL_LINKS, formatLegalDate, mailto } from '@/lib/legal'

export interface LegalSection {
  id: string
  title: string
  content: React.ReactNode
}

interface Props {
  /** Shown above the title, e.g. "Legal" */
  eyebrow?: string
  title: string
  /** <title> of the browser tab */
  docTitle: string
  intro: React.ReactNode
  sections: LegalSection[]
  /** Hide the "Last updated" line (contact page) */
  undated?: boolean
  /** Hide the table of contents (short pages) */
  noToc?: boolean
  /** Hide the "Questions about this page?" card (the contact page itself) */
  noContactCard?: boolean
}

/**
 * Long-form legal page (Privacy, Terms, Community guidelines, Delete account, Contact) inside the marketing
 * layout: legal sub-navigation, title, "Last updated", table of contents (sticky on desktop, collapsible on
 * phones) and readable body text.
 */
/** support@eventlaya.com as a mailto link (optionally with a subject). */
export const Email: React.FC<{ subject?: string }> = ({ subject }) => <a href={mailto(subject)}>{CONTACT_EMAIL}</a>

export const LegalPage: React.FC<Props> = ({ eyebrow = 'Legal', title, docTitle, intro, sections, undated, noToc, noContactCard }) => {
  useEffect(() => {
    const prev = document.title
    document.title = `${docTitle} | Eventlaya`
    return () => {
      document.title = prev
    }
  }, [docTitle])

  const active = useActiveSection(sections.map((s) => s.id))

  // Links like /privacy#analytics (footer "Analytics preferences"): the page loads lazily, so scroll once it's here
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }), 60)
    return () => clearTimeout(t)
  }, [hash])
  const toc = !noToc && sections.length > 2

  return (
    <div className="bg-white">
      <div className="border-b border-ink-100 bg-ink-50/70">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
          <LegalNav />
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">{eyebrow}</p>
          <h1 className="mt-2 font-display text-[2.1rem] font-bold leading-[1.1] tracking-[-0.02em] text-ink-900 sm:text-5xl">{title}</h1>
          {!undated && (
            <p className="mt-3 text-sm text-ink-500">
              Last updated <time dateTime={LAST_UPDATED}>{formatLegalDate()}</time>
            </p>
          )}
          <div className="mt-5 max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink-700 [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3">
            {intro}
          </div>
        </div>
      </div>

      <div className={cn('mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14', toc && 'lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14')}>
        {toc && (
          <>
            {/* Phones and tablets: collapsible list */}
            <details className="group mb-10 rounded-xl border border-ink-200 bg-white lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                On this page
                <ChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <TocList sections={sections} active={active} className="border-t border-ink-100 px-2 py-2" />
            </details>
            {/* Desktop: sticky sidebar */}
            <nav aria-label="On this page" className="hidden lg:block">
              <div className="sticky top-24">
                <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">On this page</p>
                <TocList sections={sections} active={active} className="mt-3" />
              </div>
            </nav>
          </>
        )}

        <article className="min-w-0 max-w-[70ch]">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className={cn('scroll-mt-24', i > 0 && 'mt-12 border-t border-ink-100 pt-10')}>
              <h2 id={`${s.id}-h`} className="font-display text-[1.45rem] font-bold leading-snug tracking-[-0.01em] text-ink-900 sm:text-2xl">
                {s.title}
              </h2>
              <div className={PROSE}>{s.content}</div>
            </section>
          ))}

          {!noContactCard && (
          <aside className="mt-14 flex flex-col gap-3 rounded-2xl border border-ink-200 bg-ink-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-semibold text-ink-900">Questions about this page?</p>
              <p className="mt-1 text-sm text-ink-600">Write to us and a person on our team will reply.</p>
            </div>
            <a
              href={mailto(`Question about: ${title}`)}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
            >
              <Mail className="h-4 w-4" aria-hidden />
              {CONTACT_EMAIL}
            </a>
          </aside>
          )}
        </article>
      </div>
    </div>
  )
}

/** Body text styles for section content (plain JSX: p, ul/ol/li, h3, a, strong, table). */
const PROSE = cn(
  'mt-4 text-[1.0625rem] leading-[1.75] text-ink-700',
  '[&_p]:mt-4 [&_p:first-child]:mt-0',
  '[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-900',
  '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul_li]:pl-1 [&_ul_li::marker]:text-brand-400',
  '[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol_li]:pl-1 [&_ol_li::marker]:font-semibold [&_ol_li::marker]:text-ink-500',
  '[&_strong]:font-semibold [&_strong]:text-ink-900',
  '[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:decoration-brand-300 [&_a]:underline-offset-2 hover:[&_a]:decoration-brand-700',
)

const TocList: React.FC<{ sections: LegalSection[]; active: string | null; className?: string }> = ({ sections, active, className }) => (
  <ol className={cn('space-y-0.5', className)}>
    {sections.map((s, i) => (
      <li key={s.id}>
        <a
          href={`#${s.id}`}
          aria-current={active === s.id ? 'location' : undefined}
          className={cn(
            'flex gap-2.5 rounded-lg px-3 py-1.5 text-sm leading-snug transition-colors',
            active === s.id ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
          )}
        >
          <span className="w-4 shrink-0 text-right tabular-nums text-ink-400">{i + 1}</span>
          <span>{s.title}</span>
        </a>
      </li>
    ))}
  </ol>
)

/** Links between the legal pages. */
export const LegalNav: React.FC = () => (
  <nav aria-label="Legal pages" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0">
    <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
      {LEGAL_LINKS.map((l) => (
        <li key={l.to}>
          <NavLink
            to={l.to}
            className={({ isActive }) =>
              cn(
                'inline-flex whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:text-ink-900',
              )
            }
          >
            {l.label}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
)

/** The section being read: the last one whose heading has scrolled above a line just under the sticky header. */
export function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join('|')
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      let current: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 140) current = id
      }
      // At the very bottom the last sections can't reach the line: mark the last one
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = ids[ids.length - 1] ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return active
}
