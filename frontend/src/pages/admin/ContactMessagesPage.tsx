import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { request } from '@/services/api'
import { STATS_KEY } from './api'
import { PAGE } from './shared'

interface ContactMessage {
  id: string
  name: string
  email: string
  phone: string
  role_display: string
  message: string
  handled: boolean
  created_at: string
}

/** Superadmin: messages from the home page contact form. Mark each one done once you've replied. */
export const ContactMessagesPage: React.FC = () => {
  const qc = useQueryClient()
  const key = ['platform', 'contact-messages']
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: key, queryFn: () => request<ContactMessage[]>('/platform/contact/messages/') })
  const mark = useMutation({
    mutationFn: (m: ContactMessage) => request<ContactMessage>(`/platform/contact/messages/${m.id}/`, { method: 'PATCH', body: JSON.stringify({ handled: !m.handled }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    },
  })
  return (
    <div className={PAGE}>
      <PageHeader title="Contact messages" description="Sent from the contact form on the home page. Reply by email, then mark them done." />
      {isError ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Inbox className="h-6 w-6" />} title="No messages yet" description="Messages from the home page contact form show up here." />
        </Card>
      ) : (
        <Card className="min-w-0">
          <ul className="divide-y divide-ink-100">
            {data.map((m) => (
              <li key={m.id} className={m.handled ? 'px-5 py-4 opacity-60' : 'px-5 py-4'}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink-900">{m.name}</span>
                  <Badge tone="neutral">{m.role_display}</Badge>
                  {!m.handled && <Badge tone="brand">New</Badge>}
                  <span className="ml-auto text-xs text-ink-500">{formatDate(m.created_at, 'medium')}</span>
                </div>
                <p className="mt-1 text-sm text-ink-600">
                  <a href={`mailto:${m.email}`} className="font-medium text-brand-700 hover:underline">
                    {m.email}
                  </a>
                  {m.phone && ` · ${m.phone}`}
                </p>
                <p className="mt-2 whitespace-pre-line text-sm text-ink-800">{m.message}</p>
                <Button size="sm" variant="secondary" className="mt-3" loading={mark.isPending && mark.variables?.id === m.id} onClick={() => mark.mutate(m)}>
                  {m.handled ? 'Mark as new' : 'Mark done'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default ContactMessagesPage
