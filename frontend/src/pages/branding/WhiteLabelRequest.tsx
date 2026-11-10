import React, { useId, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Globe, Palette, Send, ShieldCheck, Sparkles, XCircle } from 'lucide-react'
import { Button, Card, CardHeader, ImageUpload, Input, Textarea, useToast } from '@/components/ui'
import { whiteLabelApi, type WhiteLabelRequest, type WhiteLabelRequestInput } from '@/pages/admin/api'
import { ColorField, HEX, LogoThumb, Switch } from './parts'

export const MINE_KEY = ['whiteLabelRequests', 'mine'] as const

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const fmt = (iso: string | null) => formatDate(iso, 'long')

/** What you get, shown above the request form. */
export const WhatYouGet: React.FC = () => (
  <ul className="grid gap-3 sm:grid-cols-3">
    {[
      { icon: Globe, title: 'Your own domain', text: 'Registration pages on an address like events.yourcollege.edu.np, with HTTPS.' },
      { icon: Palette, title: 'Your brand on passes', text: 'Your logo and colours on event pages, emails and QR passes.' },
      { icon: Sparkles, title: 'No Eventlaya footer', text: 'Hide “Powered by Eventlaya” so attendees only see your name.' },
    ].map((f) => (
      <li key={f.title} className="flex gap-3 rounded-2xl border border-ink-200 bg-white p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <f.icon className="h-4 w-4" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink-900">{f.title}</span>
          <span className="mt-0.5 block text-sm text-ink-500">{f.text}</span>
        </span>
      </li>
    ))}
  </ul>
)

export const RequestForm: React.FC<{
  initial?: Partial<WhiteLabelRequestInput>
  title?: string
  description?: string
  onCancel?: () => void
}> = ({ initial, title = 'Request white-label', description, onCancel }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const formId = useId()
  const [form, setForm] = useState<WhiteLabelRequestInput>({
    brand_name: '',
    requested_domain: '',
    logo_url: '',
    primary_color: '#C2215A',
    accent_color: '#E39400',
    remove_watermark: true,
    note: '',
    ...initial,
  })
  const [errors, setErrors] = useState<Partial<Record<keyof WhiteLabelRequestInput, string>>>({})
  const set = <K extends keyof WhiteLabelRequestInput>(k: K, v: WhiteLabelRequestInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const submit = useMutation({
    mutationFn: whiteLabelApi.create,
    onSuccess: (created) => {
      qc.setQueryData<WhiteLabelRequest[]>(MINE_KEY, (old) => [created, ...(old ?? [])])
      toast.success('Request sent', 'A platform admin will review it, usually within one working day.')
    },
    onError: (err: Error) => toast.error('Couldn’t send your request', err.message),
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!form.brand_name.trim()) errs.brand_name = 'Enter the name attendees should see.'
    const domain = form.requested_domain.trim().toLowerCase()
    if (domain && !DOMAIN.test(domain)) errs.requested_domain = 'Enter just the domain, like events.yourcollege.edu.np'
    if (domain.endsWith('eventlaya.com')) errs.requested_domain = 'Use a domain you own, not an eventlaya.com address.'
    if (!HEX.test(form.primary_color) || !HEX.test(form.accent_color)) errs.primary_color = 'Use 6-digit hex codes like #C2215A.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error('Check the highlighted fields')
      return
    }
    submit.mutate({ ...form, requested_domain: domain, brand_name: form.brand_name.trim() })
  }

  return (
    <Card>
      <CardHeader
        title={title}
        description={description ?? 'Tell us how your pages should look. A platform admin reviews every request before it goes live.'}
      />
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5 p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Input
            label="Brand name"
            required
            value={form.brand_name}
            error={errors.brand_name}
            onChange={(e) => set('brand_name', e.target.value)}
            placeholder="Eastern Youth Summit"
          />
          <Input
            label="Custom domain"
            hint="Optional. A subdomain you own, like events.yourcollege.edu.np"
            value={form.requested_domain}
            error={errors.requested_domain}
            onChange={(e) => set('requested_domain', e.target.value.toLowerCase().trim())}
            placeholder="events.yourorganization.com"
            className="font-mono"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <ImageUpload
            label="Logo"
            kind="logo"
            shape="square"
            value={form.logo_url || null}
            onChange={(url) => set('logo_url', url ?? '')}
            hint="Square PNG or JPG, at least 256 px"
          />
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label="Primary colour" hint="Buttons and headers" value={form.primary_color} onChange={(v) => set('primary_color', v)} />
              <ColorField label="Accent colour" hint="Badges and highlights" value={form.accent_color} onChange={(v) => set('accent_color', v)} />
            </div>
            {errors.primary_color && <p className="text-xs font-medium text-red-600">{errors.primary_color}</p>}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-ink-200 px-4 py-3">
              <div>
                <p id={`${formId}-wm`} className="text-sm font-medium text-ink-900">
                  Hide “Powered by Eventlaya”
                </p>
                <p className="mt-0.5 text-sm text-ink-500">Show only your own branding in the page footer.</p>
              </div>
              <Switch checked={form.remove_watermark} onChange={(v) => set('remove_watermark', v)} labelledBy={`${formId}-wm`} />
            </div>
          </div>
        </div>

        <Textarea
          label="Anything we should know?"
          hint="Optional. For example which events this is for, or who manages your DNS."
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          rows={3}
        />

        <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-5">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={submit.isPending}>
              Cancel
            </Button>
          )}
          <Button type="submit" icon={<Send className="h-4 w-4" />} loading={submit.isPending}>
            Send request
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Read-only summary of what was asked for. */
export const RequestSummary: React.FC<{ r: WhiteLabelRequest }> = ({ r }) => (
  <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
    <div className="flex items-center gap-3">
      <LogoThumb src={r.logo_url} name={r.brand_name} color={r.primary_color} className="h-10 w-10" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-ink-500">Brand name</dt>
        <dd className="truncate font-medium text-ink-900">{r.brand_name}</dd>
      </div>
    </div>
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-500">Custom domain</dt>
      <dd className="break-all font-mono text-[13px] text-ink-900">{r.requested_domain || <span className="font-sans text-ink-500">None</span>}</dd>
    </div>
    <div>
      <dt className="text-xs font-medium text-ink-500">Colours</dt>
      <dd className="mt-0.5 flex gap-3">
        {[r.primary_color, r.accent_color].map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="h-4 w-4 rounded border border-ink-200" style={{ backgroundColor: c }} aria-hidden />
            <span className="font-mono text-xs text-ink-700">{c}</span>
          </span>
        ))}
      </dd>
    </div>
    <div>
      <dt className="text-xs font-medium text-ink-500">Hide Eventlaya footer</dt>
      <dd className="text-ink-900">{r.remove_watermark ? 'Yes' : 'No'}</dd>
    </div>
  </dl>
)

export const PendingNotice: React.FC<{ r: WhiteLabelRequest; changeRequest?: boolean }> = ({ r, changeRequest }) => (
  <Card>
    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-marigold-50 text-marigold-700">
        <Clock className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-4">
        <div role="status">
          <h2 className="text-base font-bold text-ink-900">{changeRequest ? 'Your change request is waiting for review' : 'Waiting for review'}</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Sent on {fmt(r.created_at)}. A platform admin will approve it or tell you what to change, usually within one working day.
            {changeRequest && ' Your current branding stays live until then.'}
          </p>
        </div>
        <RequestSummary r={r} />
      </div>
    </div>
  </Card>
)

export const RejectedNotice: React.FC<{ r: WhiteLabelRequest; onRetry: () => void; retrying: boolean }> = ({ r, onRetry, retrying }) => (
  <Card className="border-red-200">
    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
        <XCircle className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2 className="text-base font-bold text-ink-900">Your request wasn’t approved</h2>
          <p className="mt-0.5 text-sm text-ink-500">Reviewed on {fmt(r.reviewed_at)}.</p>
        </div>
        {r.review_note && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="text-xs font-medium text-red-700">Reason from the platform team</p>
            <p className="mt-0.5 whitespace-pre-line">{r.review_note}</p>
          </div>
        )}
        {!retrying && (
          <Button onClick={onRetry} size="sm">
            Request again
          </Button>
        )}
      </div>
    </div>
  </Card>
)

export const ApprovedBanner: React.FC<{ r: WhiteLabelRequest }> = ({ r }) => (
  <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
    <div className="text-sm">
      <p className="font-semibold">White-label is active</p>
      <p className="mt-0.5 text-emerald-800">
        Approved on {fmt(r.reviewed_at)}
        {r.review_note ? `: “${r.review_note}”` : '.'}
      </p>
    </div>
  </div>
)
