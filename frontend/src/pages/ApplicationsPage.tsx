import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, UserCheck } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useModuleEnabled } from '@/lib/modules'
import { contestApi } from './voting/contest/api'
import { ApplicationsCard } from '@/components/ApplicationsCard'
import { ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui'
import { useCurrentEvent } from '@/lib/event-context'

/** Every application to the current event (film submissions, pageant applicants…): filter, search, review, export. */
export const ApplicationsPage: React.FC = () => {
  const { currentEvent } = useCurrentEvent()
  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader title="Applications" description={currentEvent ? `Everyone who applied to ${currentEvent.title}.` : undefined} />
      {currentEvent?.applications_enabled ? (
        <>
          <AddToContestPrompt eventId={currentEvent.id} />
          <ApplicationsCard eventId={currentEvent.id} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={currentEvent ? 'This event doesn’t take applications' : 'No event selected'}
            description="Turn on Applications in the event’s settings (Stages) to collect film submissions, contestants and more."
            action={currentEvent ? <ButtonLink to={`/app/events/${currentEvent.id}/edit?step=stages`}>Event settings</ButtonLink> : undefined}
          />
        </Card>
      )}
    </div>
  )
}

/** Accepted applicants who aren't contestants yet (accepted before the contest existed, say): add them in one click.
 *  New acceptances join the contest on their own, so this usually stays hidden. */
const AddToContestPrompt: React.FC<{ eventId: string }> = ({ eventId }) => {
  const on = useModuleEnabled('contests')
  const qc = useQueryClient()
  const toast = useToast()
  const { data: contests = [] } = useQuery({ queryKey: ['contests', eventId], queryFn: () => contestApi.list(eventId), enabled: on })
  const contest = contests.length === 1 && contests[0].status !== 'closed' ? contests[0] : undefined
  const { data } = useQuery({
    queryKey: ['pending-applicants', contest?.id],
    queryFn: () => contestApi.pendingApplicants(contest!.id),
    enabled: Boolean(contest),
  })
  const add = useMutation({
    mutationFn: () => contestApi.fromApplications(contest!.id),
    onSuccess: (added) => {
      qc.invalidateQueries({ queryKey: ['pending-applicants'] })
      qc.invalidateQueries({ queryKey: ['contests'] })
      toast.success(`Added ${added.length} ${added.length === 1 ? 'contestant' : 'contestants'}`, 'Name, photo and bio come from their applications.')
    },
    onError: (e: Error) => toast.error('Couldn’t add them', e.message),
  })
  if (!contest || !data?.pending) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4">
      <p className="text-sm text-ink-800">
        <b>{data.pending} accepted {data.pending === 1 ? 'applicant isn’t' : 'applicants aren’t'}</b> in “{contest.title}” yet.
      </p>
      <Button size="sm" icon={<UserCheck className="h-4 w-4" />} loading={add.isPending} onClick={() => add.mutate()}>
        Add to contest
      </Button>
    </div>
  )
}
