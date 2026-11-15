/** Before publishing: what's missing that visitors would notice first (banner, description). */
import type { Event } from '@/services/api'

export function pageGaps(e: Pick<Event, 'banner' | 'description'>): string[] {
  const gaps: string[] = []
  if (!e.banner) gaps.push('banner')
  if (!e.description?.trim()) gaps.push('description')
  return gaps
}

/** "no banner and no description" — for the confirm text. */
export const gapsText = (gaps: string[]) => gaps.map((g) => `no ${g}`).join(' and ')

type Confirm = (o: { title: string; description: string; confirmLabel: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>

/** Ask before publishing a bare page. Resolves true to go ahead; false sends the organizer to add the missing parts. */
export async function confirmPublish(e: Pick<Event, 'id' | 'banner' | 'description'>, confirm: Confirm, goEdit: () => void): Promise<boolean> {
  const gaps = pageGaps(e)
  if (!gaps.length) return true
  const ok = await confirm({
    title: 'Publish without a banner or description?',
    description: `Your event page has ${gapsText(gaps)} yet. Pages with them get noticeably more sign-ups. You can publish now and add them later.`,
    confirmLabel: 'Publish anyway',
    cancelLabel: 'Add them first',
  })
  if (!ok) goEdit()
  return ok
}
