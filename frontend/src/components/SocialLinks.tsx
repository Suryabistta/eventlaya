import React from 'react'
import { safeHref, useHomeContent } from '@/lib/home-content'
import { cn } from '@/lib/utils'

/** Eventlaya's social media links, set by the superadmin on the Home page editor (hidden when none are set). */
const SOCIAL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' } as const

export const SocialLinks: React.FC<{ className?: string }> = ({ className }) => {
  const { socials } = useHomeContent()
  const links = (Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[]).filter((k) => safeHref(socials[k]))
  if (!links.length) return null
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label="Eventlaya on social media">
      {links.map((k) => (
        <li key={k}>
          <a
            href={safeHref(socials[k])}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-full border border-ink-200 bg-white px-4 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            {SOCIAL_LABELS[k]}
          </a>
        </li>
      ))}
    </ul>
  )
}
