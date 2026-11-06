import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { LEGAL_PATHS, legalHref } from '@/lib/legal'
import { TENANT_HOST } from '@/lib/tenant-host'

/**
 * Link to a legal page: in-app on eventlaya.com, to eventlaya.com on white-label sites (Eventlaya's policies
 * apply there as the platform). `newTab` for links inside forms (sign-up, registration) so nothing typed is lost.
 */
export const LegalLink: React.FC<{ path: string; className?: string; newTab?: boolean; children: React.ReactNode }> = ({
  path,
  className,
  newTab,
  children,
}) => {
  const tab = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  if (TENANT_HOST) {
    return (
      <a href={legalHref(path)} className={className} {...tab}>
        {children}
      </a>
    )
  }
  return (
    <Link to={path} className={className} {...tab}>
      {children}
    </Link>
  )
}

/**
 * Room under the footer for pages with a fixed bottom action bar, so the bar never covers the links:
 * the event page and registration (phones only) and voting (all widths).
 */
export function bottomBarPadding(pathname: string): string | false {
  if (/^\/e\/[^/]+\/vote(\/[^/]+)?\/?$/.test(pathname)) return 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]'
  if (/^\/e\/[^/]+(\/register)?\/?$/.test(pathname)) return 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0'
  return false
}

/** Privacy / Terms links for attendee pages (event page, registration, pass, voting). */
export const LegalFooter: React.FC<{ className?: string }> = ({ className }) => {
  const { pathname } = useLocation()
  return (
    <footer
      className={cn(
        'border-t border-ink-200 bg-white',
        bottomBarPadding(pathname),
        className,
      )}
    >
      <LegalLinks className="mx-auto max-w-5xl px-4 py-5 sm:px-6" />
    </footer>
  )
}

/** "Privacy · Terms · Contact" in a row; links go to eventlaya.com on white-label sites. */
export const LegalLinks: React.FC<{ className?: string; withContact?: boolean }> = ({ className, withContact = true }) => {
  const links: [string, string][] = [
    ['Privacy', LEGAL_PATHS.privacy],
    ['Terms', LEGAL_PATHS.terms],
    ...(withContact ? ([['Contact', LEGAL_PATHS.contact]] as [string, string][]) : []),
    // Google Analytics runs on eventlaya.com only (lib/analytics.ts): the visitor's on/off switch
    ...(!TENANT_HOST ? ([['Analytics', `${LEGAL_PATHS.privacy}#analytics`]] as [string, string][]) : []),
  ]
  return (
    <nav aria-label="Legal" className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500', className)}>
      <span>© {new Date().getFullYear()} Eventlaya</span>
      {links.map(([label, path]) => (
        <LegalLink key={path} path={path} className="hover:text-ink-800 hover:underline">
          {label}
        </LegalLink>
      ))}
    </nav>
  )
}
