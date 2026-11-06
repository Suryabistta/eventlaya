import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Globe, Inbox, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react'
import { Button, ButtonLink, Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import type { TenantDomainStatus } from '@/services/api'
import { DomainBadge, DomainStatusPanel } from '@/pages/branding/DomainStatus'
import { platformApi, type WhiteLabelRequest } from '../api'
import { PAGE, ReasonDialog, RejectDialog, Segmented, countLabel, fmtDate, usePlatformAction, useReview, type ReviewTarget } from '../shared'
import { Thumb, WhiteLabelCard, useWhiteLabelRequests, wlTarget } from './cards'

type View = 'pending' | 'active' | 'rejected' | 'all'

const inView = (r: WhiteLabelRequest, v: View) =>
  v === 'all' || (v === 'pending' && r.status === 'pending') || (v === 'active' && r.status === 'approved') || (v === 'rejected' && (r.status === 'rejected' || r.status === 'revoked'))

export const WhiteLabelApprovalsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const view = (['pending', 'active', 'rejected', 'all'].includes(params.get('status') ?? '') ? params.get('status') : 'pending') as View
  const { data, isLoading, isError, error, refetch } = useWhiteLabelRequests('all')
  const review = useReview()
  const run = usePlatformAction()
  const [rejecting, setRejecting] = useState<ReviewTarget | null>(null)
  const [revoking, setRevoking] = useState<WhiteLabelRequest | null>(null)
  const [busyId, setBusyId] = useState<string>()
  const [statusFor, setStatusFor] = useState<WhiteLabelRequest | null>(null)

  const counts = useMemo(() => {
    const c = { pending: 0, active: 0, rejected: 0, all: data?.length ?? 0 }
    for (const r of data ?? []) for (const v of ['pending', 'active', 'rejected'] as const) if (inView(r, v)) c[v]++
    return c
  }, [data])
  const rows = (data ?? []).filter((r) => inView(r, view))

  const reopen = async (r: WhiteLabelRequest) => {
    setBusyId(r.id)
    try {
      await run(() => platformApi.reopenWhiteLabel(r.id), ['Request reopened', `${r.organizer_name}’s request is back in the queue.`], 'Couldn’t reopen the request')
    } catch {
      /* toast shown */
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="White-label"
        description="Event companies ask to use their own domain, logo and colours. Approve to switch it on, or revoke it later."
      />

      <Segmented
        label="Show"
        value={view}
        onChange={(v) => setParams(v === 'pending' ? {} : { status: v }, { replace: true })}
        options={[
          { value: 'pending', label: countLabel('Waiting for review', data && counts.pending) },
          { value: 'active', label: countLabel('Active', data && counts.active) },
          { value: 'rejected', label: countLabel('Rejected or revoked', data && counts.rejected) },
          { value: 'all', label: countLabel('All', data && counts.all) },
        ]}
      />

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={view === 'active' ? <ShieldCheck className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
            title={view === 'pending' ? 'You’re all caught up' : view === 'active' ? 'No white-label tenants yet' : 'Nothing here'}
            description={
              view === 'pending'
                ? 'New white-label requests from event companies will show up here.'
                : view === 'active'
                  ? 'Approved requests appear here with their domain and DNS status.'
                  : 'Rejected and revoked requests will be listed here with the reason.'
            }
          />
        </Card>
      ) : view === 'active' ? (
        <TenantTable rows={rows} onRevoke={setRevoking} onStatus={setStatusFor} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="White-label requests">
          {rows.map((r) => (
            <WhiteLabelCard
              key={r.id}
              r={r}
              busy={review.busyId === r.id || busyId === r.id}
              onApprove={() => review.approve(wlTarget(r))}
              onReject={() => setRejecting(wlTarget(r))}
              footer={
                r.status === 'approved' ? (
                  <Button variant="secondary" size="sm" className="text-red-700" icon={<ShieldX className="h-4 w-4" />} onClick={() => setRevoking(r)}>
                    Revoke
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} loading={busyId === r.id} onClick={() => void reopen(r)}>
                    Reopen
                  </Button>
                )
              }
            />
          ))}
        </ul>
      )}

      <TenantStatusDialog r={statusFor} onClose={() => setStatusFor(null)} />
      <RejectDialog target={rejecting} onClose={() => setRejecting(null)} onReject={review.reject} />
      <ReasonDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke white-label for ${revoking?.organizer_name ?? ''}?`}
        description="Their custom domain stops working and “Powered by Eventlaya” comes back on their pages and passes. They can request again."
        confirmLabel="Revoke white-label"
        placeholder="For example: the plan that includes white-label wasn’t renewed."
        onConfirm={(note) =>
          revoking
            ? run(() => platformApi.revokeWhiteLabel(revoking.id, note), ['White-label revoked', `${revoking.organizer_name} is back on Eventlaya branding.`], 'Couldn’t revoke white-label')
            : undefined
        }
      />
    </div>
  )
}

export default WhiteLabelApprovalsPage

/** Domain, DNS, certificate and provisioning state for one tenant, with "Check now". */
const TenantStatusDialog: React.FC<{ r: WhiteLabelRequest | null; onClose: () => void }> = ({ r, onClose }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<TenantDomainStatus | undefined>(r?.tenant?.status)
  React.useEffect(() => setStatus(r?.tenant?.status), [r])

  const check = async () => {
    if (!r) return
    setChecking(true)
    try {
      const res = await platformApi.checkWhiteLabelDomain(r.id)
      setStatus(res.status)
      if (res.status.custom_domain?.live) toast.success('Domain is live', res.message)
      else toast.info('Checked', res.message)
      void qc.invalidateQueries({ queryKey: ['platform'] })
    } catch (err) {
      toast.error('Couldn’t check the domain', err instanceof Error ? err.message : 'Try again in a moment.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal open={!!r} onClose={onClose} size="lg" title={r ? `${r.brand_name}: site and domain` : ''} description={r?.organizer_name}>
      {status ? <DomainStatusPanel status={status} admin onCheck={check} checking={checking} /> : <p className="text-sm text-ink-500">No branding yet.</p>}
    </Modal>
  )
}

const TenantTable: React.FC<{ rows: WhiteLabelRequest[]; onRevoke: (r: WhiteLabelRequest) => void; onStatus: (r: WhiteLabelRequest) => void }> = ({ rows, onRevoke, onStatus }) => (
  <Card className="min-w-0 overflow-hidden">
    <ul className="divide-y divide-ink-100 lg:hidden">
      {rows.map((r) => (
        <li key={r.id} className="space-y-3 px-5 py-4">
          <div className="flex items-start gap-3">
            <Thumb src={r.logo_url} fallback={r.brand_name} color={r.primary_color} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink-900">{r.brand_name}</p>
              <Link to={`/admin/organizations/${r.organizer}`} className="block truncate text-sm text-brand-700 hover:underline">
                {r.organizer_name}
              </Link>
            </div>
          </div>
          <p className="flex items-center gap-1.5 break-all font-mono text-[13px] text-ink-800">
            <Globe className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {r.tenant?.custom_domain || `${r.tenant?.subdomain ?? ''}.eventlaya.com`}
          </p>
          <div className="flex flex-wrap gap-2">
            <DomainBadge status={r.tenant?.status} />
          </div>
          <p className="text-xs text-ink-500">
            Approved {fmtDate(r.reviewed_at)}
            {r.reviewed_by_email ? ` by ${r.reviewed_by_email}` : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onStatus(r)}>
              Domain status
            </Button>
            <ButtonLink to={`/admin/organizations/${r.organizer}`} variant="ghost" size="sm">
              Organization
            </ButtonLink>
            <Button variant="secondary" size="sm" className="text-red-700" onClick={() => onRevoke(r)}>
              Revoke
            </Button>
          </div>
        </li>
      ))}
    </ul>
    <div className="relative hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-ink-50 text-xs text-ink-500">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">Brand</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Domain</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Site status</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Footer hidden</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Approved</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Thumb src={r.logo_url} fallback={r.brand_name} color={r.primary_color} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{r.brand_name}</p>
                    <Link to={`/admin/organizations/${r.organizer}`} className="block truncate text-xs text-brand-700 hover:underline">
                      {r.organizer_name}
                    </Link>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 font-mono text-[13px] text-ink-800">
                {r.tenant?.custom_domain || <span className="font-sans text-ink-500">{r.tenant?.subdomain}.eventlaya.com</span>}
                {r.tenant?.custom_domain && <span className="block font-sans text-xs text-ink-500">{r.tenant.subdomain}.eventlaya.com</span>}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-col items-start gap-1">
                  <DomainBadge status={r.tenant?.status} />
                  <button
                    type="button"
                    onClick={() => onStatus(r)}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                    aria-label={`Domain status for ${r.brand_name}`}
                  >
                    Details
                  </button>
                </div>
              </td>
              <td className="px-3 py-3 text-ink-700">{r.remove_watermark ? 'Yes' : 'No'}</td>
              <td className="px-3 py-3 text-ink-600">
                {fmtDate(r.reviewed_at)}
                {r.reviewed_by_email && <span className="block text-xs text-ink-500">by {r.reviewed_by_email}</span>}
              </td>
              <td className="px-5 py-3">
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" className="text-red-700" onClick={() => onRevoke(r)} aria-label={`Revoke white-label for ${r.organizer_name}`}>
                    Revoke
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
)
