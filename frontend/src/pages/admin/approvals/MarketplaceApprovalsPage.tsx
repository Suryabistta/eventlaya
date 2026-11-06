import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Inbox, Store } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { platformApi, type MarketplaceBusiness } from '../api'
import { PAGE, ReasonDialog, RejectDialog, Segmented, countLabel, fmtDate, fmtNum, usePlatformAction, useReview, type ReviewTarget } from '../shared'
import { MarketplaceCard, marTarget, useMarketplaceRequests } from './cards'

type View = 'pending' | 'approved' | 'rejected'

export const MarketplaceApprovalsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const view = (['pending', 'approved', 'rejected'].includes(params.get('status') ?? '') ? params.get('status') : 'pending') as View
  const requests = useMarketplaceRequests('all')
  const businesses = useQuery({ queryKey: ['platform', 'marketplace-businesses'], queryFn: platformApi.marketplaceBusinesses })
  const review = useReview()
  const run = usePlatformAction()
  const [rejecting, setRejecting] = useState<ReviewTarget | null>(null)
  const [revoking, setRevoking] = useState<MarketplaceBusiness | null>(null)

  const pending = useMemo(() => (requests.data ?? []).filter((r) => r.status === 'pending'), [requests.data])
  const rejected = useMemo(() => (requests.data ?? []).filter((r) => r.status === 'rejected'), [requests.data])
  const active = view === 'approved' ? businesses : requests
  const list = view === 'pending' ? pending : rejected

  return (
    <div className={PAGE}>
      <PageHeader
        title="Marketplace access"
        description="Event companies that also rent venues or offer services ask for a business portal. Vendors who signed up as vendors have it already."
      />

      <Segmented
        label="Show"
        value={view}
        onChange={(v) => setParams(v === 'pending' ? {} : { status: v }, { replace: true })}
        options={[
          { value: 'pending', label: countLabel('Waiting for review', requests.data && pending.length) },
          { value: 'approved', label: countLabel('Businesses with access', businesses.data?.length) },
          { value: 'rejected', label: countLabel('Rejected', requests.data && rejected.length) },
        ]}
      />

      {active.isError ? (
        <ErrorState message={(active.error as Error)?.message} onRetry={() => void active.refetch()} />
      ) : active.isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : view === 'approved' ? (
        <BusinessTable rows={businesses.data ?? []} onRevoke={setRevoking} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={view === 'pending' ? 'You’re all caught up' : 'No rejected requests'}
            description={
              view === 'pending'
                ? 'When an event company asks to list their business on the marketplace, it shows up here.'
                : 'Requests you reject, or access you revoke, are kept here with the reason.'
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Marketplace access requests">
          {list.map((r) => (
            <MarketplaceCard
              key={r.id}
              r={r}
              busy={review.busyId === r.id}
              onApprove={() => review.approve(marTarget(r))}
              onReject={() => setRejecting(marTarget(r))}
            />
          ))}
        </ul>
      )}

      <RejectDialog target={rejecting} onClose={() => setRejecting(null)} onReject={review.reject} />
      <ReasonDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke marketplace access for ${revoking?.name ?? ''}?`}
        description="They lose the business portal and their live listings are taken off the public marketplace. Their event tools keep working."
        confirmLabel="Revoke access"
        placeholder="For example: we couldn’t verify the business address."
        onConfirm={(note) =>
          revoking
            ? run(
                () => platformApi.revokeMarketplace(revoking.id, note),
                ['Marketplace access revoked', `${revoking.name}’s listings are no longer public.`],
                'Couldn’t revoke access',
              )
            : undefined
        }
      />
    </div>
  )
}

export default MarketplaceApprovalsPage

const BusinessTable: React.FC<{ rows: MarketplaceBusiness[]; onRevoke: (b: MarketplaceBusiness) => void }> = ({ rows, onRevoke }) => {
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState icon={<Store className="h-6 w-6" />} title="No businesses yet" description="Vendors and approved event companies appear here." />
      </Card>
    )
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-ink-50 text-xs text-ink-500">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Business</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Account</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Listings</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Inquiries</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Access since</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="max-w-[260px] px-5 py-3">
                  <Link to={`/admin/organizations/${b.id}`} className="block truncate font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {b.business_name || b.name}
                  </Link>
                  <span className="block truncate text-xs text-ink-500">{b.email}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex flex-wrap gap-1">
                    {b.role === 'vendor' ? <Badge>Vendor</Badge> : <Badge tone="brand">Event company with access</Badge>}
                    {!b.is_active && <Badge tone="danger">Suspended</Badge>}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular text-ink-700">
                  {fmtNum(b.listings.live)} live
                  {b.listings.pending > 0 && <span className="block text-xs text-marigold-700">{b.listings.pending} pending</span>}
                </td>
                <td className="px-3 py-3 text-right tabular text-ink-700">{fmtNum(b.inquiries)}</td>
                <td className="px-3 py-3 text-ink-600">
                  {b.role === 'vendor' ? 'Vendor account' : fmtDate(b.approved_at)}
                  {b.approved_by && <span className="block text-xs text-ink-500">by {b.approved_by}</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  {b.role === 'organizer' ? (
                    <Button variant="secondary" size="sm" className="text-red-700" onClick={() => onRevoke(b)} aria-label={`Revoke marketplace access for ${b.name}`}>
                      Revoke access
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-500">Suspend from Organizations</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
