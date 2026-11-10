import React from 'react'
import { Inbox } from 'lucide-react'
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
        <ApplicationsCard eventId={currentEvent.id} />
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
