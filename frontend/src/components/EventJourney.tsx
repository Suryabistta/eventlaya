/** Top of Overview: the event's steps in order for its kind (pageant, ticketing, registration), ticked from real data,
 *  with one main button for the next step. Hidden once every step is done. */
import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { api, request, type Event } from '@/services/api'
import { Button, ButtonLink, Card, useToast } from '@/components/ui'
import { useModuleEnabled } from '@/lib/modules'
import { cn } from '@/lib/utils'
import { confirmPublish } from '@/lib/publish-check'
import { useNavigate } from 'react-router-dom'
import { contestApi } from '@/pages/voting/contest/api'

type Step = { title: string; detail: string; done: boolean; action: React.ReactNode }

export const EventJourney: React.FC<{ event: Event; onShare: () => void }> = ({ event, onShare }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const contestsOn = useModuleEnabled('contests')
  const pageant = event.applications_enabled && event.tickets_enabled === false
  const { data: apps = [] } = useQuery({
    queryKey: ['applications', event.id],
    queryFn: () => request<{ review_status: string }[]>(`/forms/events/${event.id}/applications/`),
    enabled: Boolean(event.applications_enabled),
  })
  const { data: contests = [] } = useQuery({ queryKey: ['contests', event.id], queryFn: () => contestApi.list(event.id), enabled: pageant && contestsOn })
  const publish = useMutation({
    mutationFn: () => api.updateEvent(event.id, { status: 'published' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event published', 'Your event page is public now.')
    },
    onError: (e: Error) => toast.error('Couldn’t publish', e.message),
  })

  const published = event.status !== 'draft'
  const publishStep: Step = {
    title: 'Publish the event',
    detail: published ? 'Your event page is public' : 'Only you can see it until you publish.',
    done: published,
    action: <Button size="sm" loading={publish.isPending} onClick={async () => { if (await confirmPublish(event, toast.confirm, () => navigate(`/app/events/${event.id}/edit?step=basics`))) publish.mutate() }}>Publish</Button>,
  }
  const share = (what: string, people: number, noun: string): Step => ({
    title: `Share the ${what} link`,
    detail: people ? `${people.toLocaleString()} ${noun} so far` : 'Post it on social media, or put the QR on posters.',
    done: people > 0,
    action: <Button size="sm" onClick={onShare}>Share link & QR</Button>,
  })

  let steps: Step[]
  if (pageant) {
    const received = apps.length
    const accepted = apps.filter((a) => a.review_status === 'accepted').length
    const contest = contests[0]
    const appsReason = event.applications_closed_reason
    steps = [
      publishStep,
      // Don't send people to a dead link: applications must really be open first
      ...(appsReason && !received
        ? [{
            title: 'Open applications',
            detail: `Visitors see: “${appsReason}”`,
            done: false,
            action: !event.application_form
              ? <ButtonLink size="sm" to="/app/forms">Add application form</ButtonLink>
              : <ButtonLink size="sm" to={`/app/events/${event.id}/edit?step=stages`}>Check the dates</ButtonLink>,
          }]
        : []),
      share('apply', received, received === 1 ? 'application' : 'applications'),
      {
        title: 'Review applications',
        detail: accepted ? `${accepted} accepted; they’re added to the contest automatically` : 'Accept the people who go through to the contest.',
        done: accepted > 0,
        action: <ButtonLink size="sm" to="/app/applications">Review applications</ButtonLink>,
      },
      ...(contest
        ? [
            {
              title: 'Open voting',
              detail: contest.status === 'open' ? 'Voting is open' : contest.status === 'scheduled' ? 'Opens on its own at the set time' : contest.status === 'closed' ? 'Voting has closed' : 'Check the contestants, then open voting.',
              done: contest.status !== 'draft',
              action: <ButtonLink size="sm" to={`/app/voting/contests/${contest.id}`}>Go to the contest</ButtonLink>,
            },
            {
              title: 'Announce the winners',
              detail: contest.winners_announced_at ? 'Winners announced' : 'After voting closes, announce the results.',
              done: Boolean(contest.winners_announced_at),
              action: <ButtonLink size="sm" to={`/app/voting/contests/${contest.id}?tab=results`}>Results</ButtonLink>,
            },
          ]
        : []),
    ]
  } else if (event.registration_mode === 'form') {
    steps = [
      publishStep,
      {
        title: 'Check the sign-up form',
        detail: event.registration_form ? 'People answer your questions when they sign up' : 'Name, email and phone only. Add questions if you need them.',
        done: Boolean(event.registration_form),
        action: <ButtonLink size="sm" to="/app/forms">Open the form</ButtonLink>,
      },
      share('sign-up', event.registered_count, event.registered_count === 1 ? 'person signed up' : 'people signed up'),
    ]
  } else {
    steps = [
      publishStep,
      share('ticket', event.registered_count, event.registered_count === 1 ? 'ticket' : 'tickets'),
      {
        title: 'Check people in on the day',
        detail: event.checked_in_count ? `${event.checked_in_count.toLocaleString()} checked in` : 'Scan passes at the gate with your phone.',
        done: event.checked_in_count > 0,
        action: <ButtonLink size="sm" to="/app/scanner">Open the scanner</ButtonLink>,
      },
    ]
  }

  const next = steps.findIndex((s) => !s.done)
  if (next === -1) return null
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink-900">
        {pageant ? 'Your pageant, step by step' : 'Your event, step by step'}
        <span className="ml-2 font-normal text-ink-500">{steps.filter((s) => s.done).length} of {steps.length} done</span>
      </p>
      <ol className={cn('mt-4 grid gap-3', steps.length > 4 ? 'md:grid-cols-5' : steps.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
        {steps.map((s, i) => (
          <li key={s.title} className={cn('flex flex-col gap-2 rounded-xl border p-4', i === next ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200')}>
            <div className="flex items-center gap-2">
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', s.done ? 'bg-emerald-600 text-white' : i === next ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600')}>
                {s.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="font-semibold text-ink-900">{s.title}</span>
              {s.done && <span className="sr-only">(done)</span>}
            </div>
            <p className="flex-1 text-sm text-ink-600">{s.detail}</p>
            {i === next && <div>{s.action}</div>}
          </li>
        ))}
      </ol>
    </Card>
  )
}
