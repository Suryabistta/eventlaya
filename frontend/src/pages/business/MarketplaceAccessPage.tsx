import React, { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Building2, CheckCircle2, Clock, Inbox, Store } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button, ButtonLink, Card, CardHeader, ErrorState, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { CITIES, useErrorToast } from '../marketplace/shared'
import { BUSINESS_TYPES, businessApi, type AccessRequest, type AccessRequestInput } from './api'
import { PAGE } from './ListingsPage'
import { fmtDate } from './InquiriesPage'

const BENEFITS = [
  { icon: Building2, title: 'List venues and services', text: 'Add your halls, lawns or services with photos and prices.' },
  { icon: Inbox, title: 'Get booking inquiries', text: 'Organizers send requests straight to your inbox.' },
  { icon: Store, title: 'Keep your event tools', text: 'Your events, forms and gate scanning stay as they are.' },
]

const RequestForm: React.FC<{ previous?: AccessRequest | null; onDone: () => void }> = ({ previous, onDone }) => {
  const toast = useToast()
  const { user } = useAuth()
  const lastInvalidToast = useRef(0)
  const [form, setForm] = useState<AccessRequestInput>({
    business_name: previous?.business_name ?? user?.organization_name ?? '',
    business_type: previous?.business_type ?? 'venue',
    city: previous?.city ?? 'Itahari',
    phone: previous?.phone ?? user?.phone ?? '',
    note: previous?.note ?? '',
  })
  const [submitting, setSubmitting] = useState(false)
  const set = <K extends keyof AccessRequestInput>(k: K, v: AccessRequestInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await businessApi.requestAccess({ ...form, business_name: form.business_name.trim(), phone: form.phone.trim(), note: form.note.trim() })
      toast.success('Request sent', 'We’ll review it and let you know here, usually within a working day.')
      onDone()
    } catch (err) {
      toast.error('Couldn’t send your request', err instanceof Error ? err.message : 'Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  const onInvalid = () => {
    if (Date.now() - lastInvalidToast.current < 1000) return
    lastInvalidToast.current = Date.now()
    toast.error('Some details are missing', 'Fill in the highlighted fields, then send again.')
  }

  return (
    <Card>
      <CardHeader title={previous ? 'Request again' : 'Tell us about your business'} description="A platform admin checks every business before it can list in the marketplace." />
      <form onSubmit={submit} onInvalidCapture={onInvalid} className="space-y-4 p-5">
        <Input label="Business name" required value={form.business_name} onChange={(e) => set('business_name', e.target.value)} placeholder="Biratnagar Party Palace" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="What do you offer?" value={form.business_type} onChange={(e) => set('business_type', e.target.value as AccessRequestInput['business_type'])}>
            {BUSINESS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select label="City" value={form.city} onChange={(e) => set('city', e.target.value)}>
            {[...new Set([...CITIES, form.city])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <Input label="Business phone" type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX" containerClassName="sm:max-w-xs" />
        <Textarea
          label="Anything we should know?"
          hint="Optional. For example how many halls you rent out, or your registration number."
          rows={3}
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={submitting} className="w-full sm:w-auto">
            Send request
          </Button>
        </div>
      </form>
    </Card>
  )
}

const Summary: React.FC<{ request: AccessRequest }> = ({ request }) => (
  <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
    {[
      ['Business', request.business_name],
      ['Type', request.business_type_display],
      ['City', request.city],
      ['Phone', request.phone],
      ['Sent', fmtDate(request.created_at)],
      ...(request.note ? [['Note', request.note]] : []),
    ].map(([k, v]) => (
      <div key={k} className={k === 'Note' ? 'sm:col-span-2' : undefined}>
        <dt className="text-ink-500">{k}</dt>
        <dd className="font-medium text-ink-900">{v}</dd>
      </div>
    ))}
  </dl>
)

export const MarketplaceAccessPage: React.FC = () => {
  const { user, refresh } = useAuth()
  const queryClient = useQueryClient()
  const [requestingAgain, setRequestingAgain] = useState(false)
  const query = useQuery({ queryKey: ['marketplace-access-request'], queryFn: businessApi.myAccessRequest })
  useErrorToast(query.isError, query.error, 'Couldn’t load your request')

  const latest = query.data
  // Pick up an approval or rejection made since the user signed in, so the nav updates too.
  useEffect(() => {
    if (latest && latest.status !== user?.marketplace_access && latest.status !== 'pending') refresh().catch(() => undefined)
  }, [latest, user?.marketplace_access, refresh])

  if (user?.role === 'vendor') return <Navigate to="/app/business" replace />

  const onSent = async () => {
    setRequestingAgain(false)
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['marketplace-access-request'] }), refresh().catch(() => undefined)])
  }

  const status = latest?.status ?? (user?.marketplace_access === 'approved' ? 'approved' : undefined)

  return (
    <div className={PAGE}>
      <PageHeader
        title="List your business"
        description="Rent out halls or offer event services? Get a business portal next to your event tools to list them in the Eventlaya marketplace."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          {query.isError ? (
            <ErrorState message={query.error.message} onRetry={query.refetch} />
          ) : query.isLoading ? (
            <Skeleton className="h-96 rounded-2xl" />
          ) : status === 'approved' ? (
            <Card className="p-5 sm:p-6">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-bold text-ink-900">Your business portal is ready</h2>
                    <p className="mt-1 text-sm text-ink-600">
                      You can now list venues and services and answer booking inquiries. Find them under Business in the menu.
                    </p>
                    {latest?.review_note && <p className="mt-2 text-sm text-ink-600">Note from our team: {latest.review_note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink to="/app/business">Open business home</ButtonLink>
                    <ButtonLink to="/app/listings/venues/new" variant="secondary">
                      Add a venue
                    </ButtonLink>
                  </div>
                </div>
              </div>
            </Card>
          ) : status === 'pending' && latest ? (
            <Card>
              <div className="flex gap-3 border-b border-ink-100 p-5">
                <Clock className="mt-0.5 h-6 w-6 shrink-0 text-marigold-600" aria-hidden />
                <div>
                  <h2 className="text-lg font-bold text-ink-900">Waiting for review</h2>
                  <p className="mt-1 text-sm text-ink-600">We usually review requests within a working day. This page updates once it’s decided.</p>
                </div>
              </div>
              <div className="p-5">
                <Summary request={latest} />
              </div>
            </Card>
          ) : status === 'rejected' && latest && !requestingAgain ? (
            <Card>
              <div className="flex gap-3 border-b border-ink-100 p-5">
                <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden />
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-bold text-ink-900">We couldn’t approve this request</h2>
                    <p className="mt-1 text-sm text-ink-600">{latest.review_note || 'No reason was given.'}</p>
                  </div>
                  <Button onClick={() => setRequestingAgain(true)}>Request again</Button>
                </div>
              </div>
              <div className="p-5">
                <Summary request={latest} />
              </div>
            </Card>
          ) : (
            <RequestForm previous={latest} onDone={onSent} />
          )}
        </div>

        <Card className="h-fit p-5 xl:col-span-4">
          <h2 className="text-base font-bold text-ink-900">What you get</h2>
          <ul className="mt-4 space-y-4">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <b.icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">{b.title}</p>
                  <p className="text-sm text-ink-500">{b.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

export default MarketplaceAccessPage
