import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight, Search } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, useToast } from '@/components/ui'
import { platformApi, STATS_KEY, type Organization } from './api'
import { PAGE, fmtDate, fmtNum } from './shared'

type Sort = 'newest' | 'registrations' | 'events' | 'name'

export const roleBadge = (o: Pick<Organization, 'role' | 'marketplace_access'>) =>
  o.role === 'vendor' ? (
    <Badge tone="neutral">Vendor</Badge>
  ) : (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone="brand">Event company</Badge>
      {o.marketplace_access === 'approved' && <Badge tone="neutral">Also on marketplace</Badge>}
      {o.marketplace_access === 'pending' && <Badge tone="warning">Marketplace pending</Badge>}
    </span>
  )

export const statusBadge = (active: boolean) =>
  active ? (
    <Badge tone="success" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="danger" dot>
      Suspended
    </Badge>
  )

/** Suspend/activate with a confirmation for suspending. Shared with the detail page. */
export function useOrgStatus() {
  const qc = useQueryClient()
  const toast = useToast()
  const mutation = useMutation({
    mutationFn: (o: Pick<Organization, 'id' | 'name' | 'is_active'>) => (o.is_active ? platformApi.suspend(o.id) : platformApi.activate(o.id)),
    onSuccess: (res) => {
      toast.success(
        res.is_active ? `${res.name} is active again` : `${res.name} is suspended`,
        res.is_active ? 'They can sign in and their pages are back.' : 'They can’t sign in until you activate the account.',
      )
    },
    onError: (err: Error, o) => toast.error(`Couldn’t update ${o.name}`, err.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['platform'] })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    },
  })
  const toggle = async (o: Pick<Organization, 'id' | 'name' | 'is_active'>) => {
    if (o.is_active) {
      const ok = await toast.confirm({
        title: `Suspend ${o.name}?`,
        description: 'They’ll be signed out and can’t sign in. Their data stays, and you can activate the account again at any time.',
        confirmLabel: 'Suspend account',
        danger: true,
      })
      if (!ok) return
    }
    mutation.mutate(o)
  }
  return { toggle, busyId: mutation.isPending ? mutation.variables?.id : undefined }
}

export const OrganizationsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const type = params.get('type') || 'all'
  const status = params.get('status') || 'all'
  const sort = (params.get('sort') as Sort) || 'newest'
  const plan = params.get('plan') || 'all'
  const city = params.get('city') || ''
  const [search, setSearch] = useState(params.get('search') || '')
  const [debounced, setDebounced] = useState(search)
  const orgStatus = useOrgStatus()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const setParam = (key: string, value: string, fallback: string) => {
    const p = new URLSearchParams(params)
    if (value === fallback || !value) p.delete(key)
    else p.set(key, value)
    setParams(p, { replace: true })
  }

  useEffect(() => {
    if ((params.get('search') || '') !== debounced) setParam('search', debounced, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['platform', 'organizations', { type, status, plan, city, search: debounced }],
    queryFn: () => platformApi.organizations({ type, status, plan, city, search: debounced }),
    placeholderData: (prev) => prev,
  })

  const rows = useMemo(() => {
    const list = [...(data ?? [])]
    if (sort === 'registrations') list.sort((a, b) => b.registrations - a.registrations)
    else if (sort === 'events') list.sort((a, b) => b.events - a.events)
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [data, sort])

  const filtered = type !== 'all' || status !== 'all' || plan !== 'all' || !!city || !!debounced

  return (
    <div className={PAGE}>
      <PageHeader title="Organizations" description="Every event company and vendor on Eventlaya. Open one to see their events, or suspend an account." />

      <Card>
        <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1fr)_200px_160px_160px_190px]">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4 2xl:col-span-1">
            <label htmlFor="org-search" className="block text-sm font-medium text-ink-800">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="org-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email or phone"
                className="block w-full rounded-[10px] border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <Select label="Type" value={type} onChange={(e) => setParam('type', e.target.value, 'all')}>
            <option value="all">All types</option>
            <option value="organizer">Event companies</option>
            <option value="events_only">Event companies without marketplace</option>
            <option value="both">Event companies with marketplace</option>
            <option value="vendor">Vendors</option>
          </Select>
          <Select label="Plan" value={plan} onChange={(e) => setParam('plan', e.target.value, 'all')}>
            <option value="all">Any plan</option>
            <option value="free">Free</option>
            <option value="event_pro">Event Pro</option>
            <option value="business">Business</option>
            <option value="enterprise">Enterprise</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => setParam('status', e.target.value, 'all')}>
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Select label="Sort by" value={sort} onChange={(e) => setParam('sort', e.target.value, 'newest')}>
            <option value="newest">Newest first</option>
            <option value="registrations">Most registrations</option>
            <option value="events">Most events</option>
            <option value="name">Name</option>
          </Select>
        </div>

        {city && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-2.5 text-sm text-ink-700">
            Active in <Badge tone="brand">{city}</Badge>
            <button type="button" onClick={() => setParam('city', '', '')} className="font-semibold text-brand-700 hover:underline">
              Clear city
            </button>
          </div>
        )}
        {isError ? (
          <div className="p-5">
            <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={filtered ? 'No organizations match' : 'No organizations yet'}
            description={filtered ? 'Try a different search or clear the filters.' : 'Event companies and vendors appear here when they sign up.'}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setParams({}, { replace: true })
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="px-5 pt-3 text-sm text-ink-500" aria-live="polite">
              {rows.length} {rows.length === 1 ? 'organization' : 'organizations'}
              {isFetching && ', updating…'}
            </p>
            {/* Phone: stacked list */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link to={`/admin/organizations/${o.id}`} className="flex items-start gap-3 px-5 py-4 hover:bg-ink-50">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-semibold text-ink-900">{o.name}</p>
                      <p className="truncate text-sm text-ink-500">{o.email}</p>
                      <div className="flex flex-wrap gap-1">
                        {roleBadge(o)}
                        {!o.is_active && statusBadge(false)}
                      </div>
                      <p className="text-xs text-ink-500">
                        {fmtNum(o.events)} events, {fmtNum(o.registrations)} registrations
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {/* Tablet and up: table */}
            <div className="relative hidden overflow-x-auto md:block">
              <table className="mt-2 w-full min-w-[760px] text-left text-sm">
                <thead className="bg-ink-50 text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Organization
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Events
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Registrations
                    </th>
                    <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">
                      Joined
                    </th>
                    <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">
                      Last sign-in
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a,button')) return
                        navigate(`/admin/organizations/${o.id}`)
                      }}
                      className="cursor-pointer hover:bg-ink-50/70"
                    >
                      <td className="max-w-[280px] px-5 py-3">
                        <Link to={`/admin/organizations/${o.id}`} className="block truncate font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                          {o.name}
                        </Link>
                        <span className="block truncate text-xs text-ink-500">{o.email}</span>
                      </td>
                      <td className="px-3 py-3">
                        {roleBadge(o)}
                        <span className="mt-1 block text-xs text-ink-500">{o.plan ?? 'Free'} plan</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-700">{fmtNum(o.events)}</td>
                      <td className="px-3 py-3 text-right tabular text-ink-700">{fmtNum(o.registrations)}</td>
                      <td className="hidden px-3 py-3 text-ink-600 lg:table-cell">{fmtDate(o.date_joined)}</td>
                      <td className="hidden px-3 py-3 text-ink-600 xl:table-cell">{fmtDate(o.last_login)}</td>
                      <td className="px-3 py-3">{statusBadge(o.is_active)}</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant={o.is_active ? 'ghost' : 'secondary'}
                          className={o.is_active ? 'text-red-700 hover:bg-red-50 hover:text-red-800' : undefined}
                          loading={orgStatus.busyId === o.id}
                          onClick={() => void orgStatus.toggle(o)}
                          aria-label={`${o.is_active ? 'Suspend' : 'Activate'} ${o.name}`}
                        >
                          {o.is_active ? 'Suspend' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

export default OrganizationsPage
