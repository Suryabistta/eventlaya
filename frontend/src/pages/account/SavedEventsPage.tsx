/** /app/my/saved: events the signed-in person saved with the heart button. */
import React from 'react'
import { Heart } from 'lucide-react'
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { useFavourites } from '@/lib/favourites'
import { eventPhase } from '@/lib/phase'
import { EventCard } from '../ExploreEventsPage'

export const SavedEventsPage: React.FC = () => {
  const { events, query } = useFavourites()
  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader title="Saved events" description="Events you saved with the heart. They stay here on any device you sign in on." />
      {query.isError ? (
        <ErrorState message={query.error?.message} onRetry={query.refetch} />
      ) : query.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Heart className="h-6 w-6" />}
            title="No saved events yet"
            description="Tap the heart on any event to keep it here."
            action={<ButtonLink to="/events">Explore events</ButtonLink>}
          />
        </Card>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => <EventCard key={e.id} event={e} past={eventPhase(e) === 'ended'} />)}
        </ul>
      )}
    </div>
  )
}
