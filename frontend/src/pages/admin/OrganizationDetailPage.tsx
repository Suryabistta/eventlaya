import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, DoorOpen, ExternalLink, Globe, KeyRound, Mail, Phone, Ticket } from 'lucide-react'
import { VerifiedBadge } from '@/components/VerifiedBadge'
import { ResetPasswordModal } from './OrganizationActions'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile, useToast } from '@/components/ui'
import { platformApi, type ListingKind, type OrganizationDetail } from './api'
import { roleBadge, statusBadge, useOrgStatus } from './OrganizationsPage'
import { PAGE, ReviewBadge, Switch, fmtDate, fmtNum, timeAgo } from './shared'

const eventStatus: Record<OrganizationDetail['events_list'][number]['status'], { label: string; tone: 'neutral' | 'brand' | 'success' | 'danger' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'brand' },
  ongoing: { label: 'Happening now', tone: 'success' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

export const OrganizationDetailPage: React.FC = () => {
  const { id = '' } = useParams()
  const { data: o, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform', 'organization', id],
    queryFn: () => platformApi.organization(id),
  })
  const orgStatus = useOrgStatus()
  const [resetting, setResetting] = useState(false)
  const toast = useToast()
  const qc = useQueryClient()
  const verify = useMutation({
    mutationFn: (v: { kind: 'organization' | ListingKind; id: string; is_verified: boolean }) =>
      v.kind === 'organization' ? platformApi.verifyOrganization(v.id, v.is_verified) : platformApi.verifyListing(v.kind, v.id, v.is_verified),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['platform', 'organization', id] })
      void qc.invalidateQueries({ queryKey: ['platform', 'organizations'] })
      toast.success(v.is_verified ? 'Verified' : 'Verification removed')
    },
    onError: (err: Error) => toast.error('Couldn’t change verification', err.message),
  })

  const back = (
    <Link to="/admin/organizations" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
      <ArrowLeft className="h-4 w-4" aria-hidden /> All organizations
    </Link>
  )

  if (isError)
    return (
      <div className={PAGE}>
        {back}
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      </div>
    )

  if (isLoading || !o)
    return (
      <div className={PAGE}>
        {back}
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )

  const wl = o.white_label

  return (
    <div className={PAGE}>
      {back}
      <PageHeader
        title={
          <>
            {o.name}
            {o.is_verified && <VerifiedBadge />}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {roleBadge(o)}
            {statusBadge(o.is_active)}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => setResetting(true)}>
              Reset password
            </Button>
            <Button
              variant={o.is_active ? 'secondary' : 'primary'}
              className={o.is_active ? 'text-red-700 hover:text-red-800' : undefined}
              loading={orgStatus.busyId === o.id}
              onClick={() => void orgStatus.toggle(o)}
            >
              {o.is_active ? 'Suspend account' : 'Activate account'}
            </Button>
          </>
        }
      />
      <ResetPasswordModal open={resetting} onClose={() => setResetting(false)} org={o} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Events" value={fmtNum(o.events)} icon={<CalendarDays className="h-5 w-5" />} tone="brand" />
        <StatTile label="Registrations" value={fmtNum(o.registrations)} icon={<Ticket className="h-5 w-5" />} />
        <StatTile
          label="Check-ins"
          value={fmtNum(o.checkins)}
          hint={o.registrations ? `${Math.round((o.checkins / o.registrations) * 100)}% of registrations` : undefined}
          icon={<DoorOpen className="h-5 w-5" />}
          tone="success"
        />
        <StatTile label="Joined" value={<span className="text-xl">{fmtDate(o.date_joined)}</span>} hint={`Last sign-in: ${fmtDate(o.last_login)}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-8">
          <CardHeader title="Events" description="Newest first" />
          {o.events_list.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No events yet" description="Events this company creates will be listed here." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-ink-50 text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Event
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Registered
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Checked in
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {o.events_list.map((e) => (
                    <tr key={e.id}>
                      <td className="max-w-[280px] px-5 py-3">
                        <a
                          href={`/e/${e.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 font-medium text-ink-900 hover:text-brand-700 hover:underline"
                        >
                          <span className="truncate">{e.title}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                          <span className="sr-only">(opens public page in a new tab)</span>
                        </a>
                        <span className="block truncate text-xs text-ink-500">{e.location}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-600">{fmtDate(e.start_date)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={eventStatus[e.status].tone}>{eventStatus[e.status].label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-700">{fmtNum(e.registrations)}</td>
                      <td className="px-5 py-3 text-right tabular text-ink-700">{fmtNum(e.checkins)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-6 xl:col-span-4">
          <Card>
            <CardHeader title="Contact" />
            <dl className="space-y-3 p-5 text-sm">
              <div className="flex items-center gap-2">
                <dt>
                  <Mail className="h-4 w-4 text-ink-400" aria-hidden />
                  <span className="sr-only">Email</span>
                </dt>
                <dd className="min-w-0 break-all">
                  <a href={`mailto:${o.email}`} className="text-brand-700 hover:underline">
                    {o.email}
                  </a>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>
                  <Phone className="h-4 w-4 text-ink-400" aria-hidden />
                  <span className="sr-only">Phone</span>
                </dt>
                <dd>{o.phone ? <a href={`tel:${o.phone}`}>{o.phone}</a> : <span className="text-ink-500">Not given</span>}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Verification" description="The blue tick on their name, event pages and listings" />
            <ul className="divide-y divide-ink-100">
              {[
                { kind: 'organization' as const, id: o.id, name: o.name, sub: 'Organization', is_verified: o.is_verified },
                ...o.listings.map((l) => ({ ...l, sub: l.kind === 'venue' ? 'Venue listing' : 'Vendor listing' })),
              ].map((row) => (
                <li key={`${row.kind}-${row.id}`} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-ink-900">{row.name}</p>
                    <p className="text-ink-500">{row.sub}</p>
                  </div>
                  <Switch
                    size="sm"
                    checked={row.is_verified}
                    disabled={verify.isPending}
                    label={`Verified: ${row.name}`}
                    onChange={(is_verified) => verify.mutate({ kind: row.kind, id: row.id, is_verified })}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {o.admin_actions.length > 0 && (
            <Card>
              <CardHeader title="Admin history" />
              <ul className="divide-y divide-ink-100 text-sm">
                {o.admin_actions.map((a) => (
                  <li key={`${a.kind}-${a.at}`} className="px-5 py-3">
                    <p className="font-medium text-ink-900">{a.label}</p>
                    <p className="text-ink-500" title={new Date(a.at).toLocaleString()}>
                      {timeAgo(a.at)}
                      {a.actor && ` · ${a.actor}`}
                      {a.note && ` · ${a.note}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {o.role === 'organizer' && (
            <Card>
              <CardHeader title="White-label" />
              <div className="space-y-3 p-5 text-sm">
                {wl.active ? (
                  <>
                    <Badge tone="success">Active</Badge>
                    <p className="flex items-center gap-2 text-ink-700">
                      <Globe className="h-4 w-4 text-ink-400" aria-hidden />
                      {wl.custom_domain ? (
                        <span className="font-mono text-[13px]">
                          {wl.custom_domain} {wl.is_domain_verified ? '(verified)' : '(DNS not verified yet)'}
                        </span>
                      ) : (
                        'No custom domain'
                      )}
                    </p>
                  </>
                ) : wl.status === 'none' ? (
                  <p className="text-ink-500">Hasn’t requested white-label.</p>
                ) : (
                  <ReviewBadge status={wl.status} />
                )}
                {wl.status === 'pending' && (
                  <Link to="/admin/approvals?tab=white-label" className="block font-semibold text-brand-700 hover:underline">
                    Review the request
                  </Link>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrganizationDetailPage
