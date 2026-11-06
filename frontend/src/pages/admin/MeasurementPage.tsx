import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, History, Save, ShieldCheck, Undo2 } from 'lucide-react'
import { ApiError, request } from '@/services/api'
import { Badge, Button, Card, CardHeader, ErrorState, Input, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PAGE, fmtDate, timeAgo } from './shared'

/**
 * Admin → Analytics: Google Analytics 4, search-engine verification and Cloudflare Web Analytics for eventlaya.com
 * (backend apps/site_analytics; docs/analytics.md). The file is not called "Analytics…" because ad blockers block
 * scripts with that name.
 */

interface SiteSettings {
  enabled: boolean
  measurement_id: string
  track_app_pages: boolean
  google_site_verification: string
  bing_site_verification: string
  cloudflare_token: string
}

interface SettingsResponse {
  settings: SiteSettings
  saved: boolean
  updated_at: string | null
  updated_by_email: string | null
  env_measurement_id: string
  effective: {
    enabled: boolean
    measurement_id: string
    measurement_id_source: 'settings' | 'environment' | ''
    track_app_pages: boolean
    ga_active: boolean
    cloudflare_token: string
  }
  history: { id: number; changed_at: string; changed_by_email: string; changes: Record<string, [unknown, unknown]> }[]
}

const KEY = ['site-analytics-settings']
const api = {
  get: () => request<SettingsResponse>('/site/settings/'),
  save: (body: Partial<SiteSettings>) => request<SettingsResponse>('/site/settings/', { method: 'PATCH', body: JSON.stringify(body) }),
}

const ID_RE = /^G-[A-Z0-9]{6,12}$/
const FIELD_LABELS: Record<keyof SiteSettings, string> = {
  enabled: 'Measurement switch',
  measurement_id: 'Measurement ID',
  track_app_pages: 'Signed-in pages',
  google_site_verification: 'Google verification',
  bing_site_verification: 'Bing verification',
  cloudflare_token: 'Cloudflare token',
}

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }> = ({ checked, onChange, label, id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2',
      checked ? 'bg-brand-600' : 'bg-ink-300',
    )}
  >
    <span aria-hidden className={cn('inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
  </button>
)

const ToggleRow: React.FC<{ title: string; description: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }> = ({
  title,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mt-0.5 text-sm text-ink-500">{description}</p>
    </div>
    <Switch checked={checked} onChange={onChange} label={title} />
  </div>
)

function shown(field: string, value: unknown) {
  if (typeof value === 'boolean') return field === 'enabled' ? (value ? 'on' : 'off') : value ? 'yes' : 'no'
  if (value === null || value === undefined || value === '') return 'empty'
  return String(value)
}

export const MeasurementPage: React.FC = () => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: api.get })
  const [draft, setDraft] = useState<SiteSettings | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof SiteSettings, string>>>({})

  useEffect(() => {
    if (data && !draft) setDraft(data.settings)
  }, [data, draft])

  const dirty = useMemo(
    () => (data && draft ? (Object.keys(draft) as (keyof SiteSettings)[]).filter((k) => draft[k] !== data.settings[k]) : []),
    [data, draft],
  )

  const save = useMutation({
    mutationFn: (body: Partial<SiteSettings>) => api.save(body),
    onSuccess: (res) => {
      qc.setQueryData(KEY, res)
      setDraft(res.settings)
      setErrors({})
      toast.success('Analytics settings saved', 'Visitors get the new settings within about two minutes.')
    },
    onError: (err: Error) => {
      const fieldErrors: Partial<Record<keyof SiteSettings, string>> = {}
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        for (const [k, v] of Object.entries(err.data as Record<string, unknown>))
          if (k in FIELD_LABELS && Array.isArray(v)) fieldErrors[k as keyof SiteSettings] = String(v[0])
      }
      setErrors(fieldErrors)
      toast.error('Couldn’t save', err.message)
    },
  })

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || !data) return
    const id = draft.measurement_id.trim().toUpperCase()
    if (id && !ID_RE.test(id) && !id.includes('GTAG')) {
      setErrors({ measurement_id: 'A GA4 Measurement ID looks like G-ABC123XYZ9.' })
      return
    }
    const body: Partial<SiteSettings> = {}
    for (const k of dirty) (body as Record<string, unknown>)[k] = draft[k]
    save.mutate(body)
  }

  if (isLoading || (!draft && !isError)) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }
  if (isError || !data || !draft) {
    return (
      <div className={PAGE}>
        <ErrorState message="Couldn’t load the analytics settings." onRetry={() => void refetch()} />
      </div>
    )
  }

  const eff = data.effective
  const envId = data.env_measurement_id
  const status = !eff.enabled
    ? { tone: 'neutral' as const, label: 'Off' }
    : eff.ga_active
      ? { tone: 'success' as const, label: 'Live' }
      : { tone: 'warning' as const, label: 'No Measurement ID' }

  return (
    <form className={PAGE} onSubmit={submit} noValidate>
      <PageHeader
        title="Analytics"
        description="Google Analytics 4 for eventlaya.com, search-engine verification and optional Cloudflare Web Analytics. White-label sites never load any of it."
        actions={
          <>
            {dirty.length > 0 && (
              <Button type="button" variant="secondary" icon={<Undo2 className="h-4 w-4" aria-hidden />} onClick={() => { setDraft(data.settings); setErrors({}) }}>
                Discard
              </Button>
            )}
            <Button type="submit" loading={save.isPending} disabled={!dirty.length} icon={<Save className="h-4 w-4" aria-hidden />}>
              Save changes
            </Button>
          </>
        }
      />

      {/* Status */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <p className="text-sm text-ink-700">
            {eff.ga_active ? (
              <>
                Sending to <span className="font-mono font-semibold text-ink-900">{eff.measurement_id}</span>
                {eff.measurement_id_source === 'environment' ? ' (from the server environment)' : ''} ·{' '}
                {eff.track_app_pages ? 'public and signed-in pages' : 'public pages only'}
              </>
            ) : !eff.enabled ? (
              'Nothing is loaded on the website.'
            ) : (
              'Add a Measurement ID to start.'
            )}
          </p>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          {data.saved && data.updated_at
            ? `Last changed ${timeAgo(data.updated_at).replace('Just now', 'just now')}${data.updated_by_email ? ` by ${data.updated_by_email}` : ''}.`
            : envId
              ? 'Not changed here yet: the Measurement ID set on the server is in use.'
              : 'Not set up yet.'}{' '}
          Check it works: open <span className="font-mono">eventlaya.com/?debug_mode=1</span> and watch GA → Admin → DebugView, or Reports → Realtime.
        </p>
      </Card>

      {/* GA4 */}
      <Card>
        <CardHeader
          title="Google Analytics 4"
          description="Page views and key events (sign-ups, registrations, payments, votes, inquiries, shares, searches), with secrets and personal data removed."
          actions={
            <a href="https://analytics.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Open GA <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          }
        />
        <div className="space-y-5 p-5">
          <ToggleRow
            title="Measure eventlaya.com"
            description="Off: no Google Analytics or Cloudflare script loads for anyone."
            checked={draft.enabled}
            onChange={(v) => set('enabled', v)}
          />
          <Input
            label="Measurement ID"
            value={draft.measurement_id}
            onChange={(e) => set('measurement_id', e.target.value)}
            placeholder={envId ? `${envId} (server default)` : 'G-XXXXXXXXXX'}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase sm:max-w-xs"
            error={errors.measurement_id}
            hint={
              envId
                ? `Empty uses the server’s ${envId}. GA → Admin → Data streams → Web → Measurement ID.`
                : 'GA → Admin → Data streams → your web stream → Measurement ID (G-…).'
            }
          />
          <ToggleRow
            title="Also measure signed-in pages"
            description="/app, /admin and judging screens. Off (recommended): only public pages, sign-up, registration, voting and payments are measured."
            checked={draft.track_app_pages}
            onChange={(v) => set('track_app_pages', v)}
          />
        </div>
      </Card>

      {/* Verification */}
      <Card>
        <CardHeader
          title="Search engine verification"
          description="Adds the verification meta tag to the homepage and other server-rendered pages. Paste the code or the whole tag."
        />
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <Input
            label="Google Search Console"
            value={draft.google_site_verification}
            onChange={(e) => set('google_site_verification', e.target.value)}
            placeholder='<meta name="google-site-verification" content="…">'
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            error={errors.google_site_verification}
            hint="Search Console → Add property → URL prefix https://eventlaya.com → HTML tag."
          />
          <Input
            label="Bing Webmaster Tools"
            value={draft.bing_site_verification}
            onChange={(e) => set('bing_site_verification', e.target.value)}
            placeholder='<meta name="msvalidate.01" content="…">'
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            error={errors.bing_site_verification}
            hint="Bing Webmaster Tools → Add site → HTML Meta Tag (or import from Search Console instead)."
          />
        </div>
      </Card>

      {/* Cloudflare */}
      <Card>
        <CardHeader title="Cloudflare Web Analytics" description="Optional, cookieless visit counts. Counts only the first page of each visit and skips pages with private links." />
        <div className="p-5">
          <Input
            label="Site token"
            value={draft.cloudflare_token}
            onChange={(e) => set('cloudflare_token', e.target.value)}
            placeholder="Token or the JS snippet"
            autoComplete="off"
            spellCheck={false}
            className="font-mono sm:max-w-md"
            error={errors.cloudflare_token}
            hint="Cloudflare → Analytics & Logs → Web Analytics → Add a site → Manage site → JS snippet. Leave empty if you use automatic setup."
          />
        </div>
      </Card>

      {/* Privacy */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">Built to be privacy-safe</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Pass links, reset and verification links, payment data, emails, phone numbers and codes are removed from every URL; no names, emails or phone numbers in events.</li>
              <li>Google signals, ad personalization and ad cookies are off. Visitors can turn analytics off on the Privacy page; Do Not Track and Global Privacy Control are respected.</li>
              <li>
                In GA itself (once): turn off Enhanced measurement → Page views → “Page changes based on browser history events” and “Form interactions”,
                turn off “User-provided data collection”, keep Google signals off and set data retention to 14 months. Steps: docs/analytics.md.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* History */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-ink-400" aria-hidden />Change history</span>} description="Who changed these settings, and what." />
        {data.history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="w-full shrink-0 text-xs text-ink-500 sm:w-48">
                  <p className="font-medium text-ink-800">{h.changed_by_email || 'Unknown'}</p>
                  <p title={new Date(h.changed_at).toLocaleString()}>
                    {timeAgo(h.changed_at)} · {fmtDate(h.changed_at)}
                  </p>
                </div>
                <ul className="min-w-0 space-y-0.5 text-sm text-ink-700">
                  {Object.keys(h.changes).length === 0 && <li>Saved the settings for the first time</li>}
                  {Object.entries(h.changes).map(([field, [from, to]]) => (
                    <li key={field} className="break-words">
                      <span className="font-medium text-ink-900">{FIELD_LABELS[field as keyof SiteSettings] ?? field}</span>: {shown(field, from)} → {shown(field, to)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </form>
  )
}

export default MeasurementPage
