import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Vote as VoteIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { votingApi } from './api'
import { fmtDateTime } from './shared'

/**
 * Drop-in card for the public event page: lists the event's public polls with a link to vote.
 * Renders nothing while loading, on error, or when the event has no public polls.
 */
export const VotingCallout: React.FC<{ slug: string; className?: string }> = ({ slug, className }) => {
  const { data } = useQuery({
    queryKey: ['public-polls', slug],
    queryFn: () => votingApi.publicPolls(slug),
    refetchInterval: 30000,
    retry: false,
  })
  const polls = (data?.polls ?? []).filter((p) => p.status !== 'closed' || p.results_visible)
  if (!polls.length) return null
  const open = polls.filter((p) => p.status === 'open')

  return (
    <section aria-labelledby="voting-callout-title" className={cn('rounded-2xl border border-brand-200 bg-brand-50/60 p-5', className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600" aria-hidden>
          <VoteIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 id="voting-callout-title" className="text-base font-bold text-ink-900">
            {open.length ? 'Voting is open' : 'Live voting'}
          </h2>
          <p className="text-sm text-ink-600">{open.length ? 'Have your say from your phone.' : 'Polls for this event.'}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {polls.map((p) => (
          <li key={p.id}>
            <Link to={`/e/${slug}/vote/${p.id}`} className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 hover:border-ink-300">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink-900">{p.title}</span>
                <span className="block text-sm text-ink-500">
                  {p.status === 'open' ? 'Vote now' : p.status === 'scheduled' && p.opens_at ? `Opens ${fmtDateTime(p.opens_at)}` : 'See the results'}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
