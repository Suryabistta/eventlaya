import React, { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Check, MapPin } from 'lucide-react'
import { request } from '@/services/api'
import { eventPageApi } from '@/lib/event-page'
import { useAuth } from '@/lib/auth'
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, Skeleton } from '@/components/ui'
import { DynamicField, EMAIL_RE, isEmpty, isVisible, keyOf, ruleError } from './EventRegisterPage'

/**
 * Applications stage of an event (module `applications`): filmmakers, contestants and the like apply with the
 * event's application form. No ticket or pass; the organizer reviews each application. Backend: ApplyView.
 */
interface Applied {
  number: string
  name: string
  email: string
  existing: boolean
}

const fmtClose = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : ''

export const ApplyPage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['publicEvent', slug], queryFn: () => eventPageApi.publicDetail(slug) })
  const [name, setName] = useState(() => (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : ''))
  const [email, setEmail] = useState(() => user?.email ?? '')
  const [phone, setPhone] = useState('')
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)

  const event = data?.event
  const call = event?.applications
  const phoneRequired = event?.phone_required ?? true
  const fields = useMemo(() => [...(call?.form?.fields ?? [])].sort((a, b) => a.order - b.order), [call?.form])

  const submit = useMutation({
    mutationFn: () =>
      request<{ application: { number: string; name: string; email: string }; already_applied?: boolean }>(`/forms/events/${slug}/apply/`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), answers }),
      }),
    onSuccess: (res) => {
      setApplied({ ...res.application, existing: Boolean(res.already_applied) })
      window.scrollTo({ top: 0 })
    },
    onError: (e: Error) => setServerError(e.message),
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Enter your full name.'
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter an email like name@example.com.'
    if (phoneRequired && (phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) errs.phone = 'Enter your mobile number.'
    for (const f of fields) {
      if (f.field_type === 'heading' || !isVisible(f, answers)) continue
      const v = answers[keyOf(f)]
      if (f.required && isEmpty(v)) errs[keyOf(f)] = ['image', 'file_upload'].includes(f.field_type) ? 'Upload a file.' : 'This field is required.'
      else if (!isEmpty(v)) {
        const problem = ruleError(f, v)
        if (problem) errs[keyOf(f)] = problem
      }
    }
    setErrors(errs)
    setServerError(null)
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.scrollIntoView({ block: 'center' }))
      return
    }
    submit.mutate()
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }
  if (isError || !event) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorState message="We couldn’t load this event." onRetry={() => refetch()} /></div>

  const back = (
    <Link to={`/e/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to event
    </Link>
  )
  // The event banner always shows beside the form (also on phones, above it)
  const side = (
    <Card className="overflow-hidden">
      {event.banner && <img src={event.banner} alt="" className="aspect-[16/7] w-full border-b border-ink-200 object-cover" />}
      <div className="space-y-1 p-4 sm:p-5">
        <p className="font-display font-bold leading-tight text-ink-900">{event.title}</p>
        {call?.closes_at && (
          <p className="flex items-start gap-1.5 text-sm text-ink-600">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            Applications close {fmtClose(call.closes_at)}
          </p>
        )}
        {!event.date_tba && (
          <p className="flex items-start gap-1.5 text-sm text-ink-600">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {event.location}
          </p>
        )}
      </div>
    </Card>
  )

  if (!call || !call.open) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
        {back}
        <Card>
          <EmptyState
            title={call?.closed_reason ?? 'This event isn’t taking applications.'}
            description="Check the event page for what’s next."
            action={<ButtonLink to={`/e/${slug}`} variant="secondary">Back to the event</ButtonLink>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      {back}
      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="lg:hidden">{side}</div>
        <div className="min-w-0">
          {applied ? (
            <Card className="p-6 text-center sm:p-8">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="h-7 w-7" aria-hidden />
              </span>
              <h1 className="mt-4 text-2xl font-bold text-ink-900">{applied.existing ? 'You’ve already applied' : 'Application received'}</h1>
              <p className="mt-2 text-ink-600">
                {applied.name}, your application for <span className="font-semibold text-ink-900">{event.title}</span> is in.
              </p>
              <p className="mt-1 text-sm text-ink-500">
                Application no. <span className="font-mono font-semibold text-ink-800">{applied.number}</span>. A confirmation was sent to {applied.email}. You’ll
                get another email once the organizer reviews it.
              </p>
              <ButtonLink to={`/e/${slug}`} variant="secondary" className="mt-6">
                Back to the event
              </ButtonLink>
            </Card>
          ) : (
            <Card>
              <form onSubmit={onSubmit} noValidate>
                <div className="border-b border-ink-100 px-5 py-5 sm:px-6">
                  <h1 className="text-xl font-bold text-ink-900">{call.form?.title || `Apply to ${event.title}`}</h1>
                  <p className="mt-1 text-sm text-ink-500">{call.form?.description || 'Fill in every required question. You can apply once per email.'}</p>
                </div>
                <div className="space-y-5 px-5 py-5 sm:px-6">
                  {serverError && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{serverError}</p>}
                  <Input label="Full name" required value={name} error={errors.name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Email" type="email" required value={email} error={errors.email} hint="We email you about your application here." onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                    <Input
                      label="Mobile number"
                      type="tel"
                      required={phoneRequired}
                      value={phone}
                      error={errors.phone}
                      hint={phoneRequired ? 'The organizer may call you about your application.' : 'Optional'}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                    />
                  </div>
                  {fields.filter((f) => isVisible(f, answers)).map((f) => (
                    <DynamicField
                      key={keyOf(f)}
                      slug={slug}
                      field={f}
                      value={answers[keyOf(f)]}
                      error={errors[keyOf(f)]}
                      onChange={(v) => {
                        setAnswers((a) => ({ ...a, [keyOf(f)]: v }))
                        if (errors[keyOf(f)]) setErrors(({ [keyOf(f)]: _, ...r }) => r)
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 sm:px-6">
                  <span className="text-sm text-ink-500">Free to apply</span>
                  <Button type="submit" size="lg" loading={submit.isPending}>
                    {call.cta || 'Apply'}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
        <div className="hidden lg:block">{side}</div>
      </div>
    </div>
  )
}

export default ApplyPage
