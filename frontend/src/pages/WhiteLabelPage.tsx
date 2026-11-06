import React, { useEffect, useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Lock, QrCode } from 'lucide-react'
import { api, type TenantBranding } from '@/services/api'
import { Button, Card, CardHeader, ErrorState, ImageUpload, Input, PageHeader, Skeleton, controlClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { whiteLabelApi, type WhiteLabelRequest } from '@/pages/admin/api'
import { ColorField, HEX, LogoThumb, Switch } from '@/pages/branding/parts'
import { DomainStatusPanel } from '@/pages/branding/DomainStatus'
import {
  ApprovedBanner,
  MINE_KEY,
  PendingNotice,
  RejectedNotice,
  RequestForm,
  RequestSummary,
  WhatYouGet,
} from '@/pages/branding/WhiteLabelRequest'

const PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

/**
 * Branding and domain. White-label is requested here and approved by a platform admin:
 * none → request form, pending → summary, rejected → reason + request again, approved → live settings.
 */
export default function WhiteLabelPage() {
  const { data: requests, isLoading, isError, error, refetch } = useQuery({ queryKey: MINE_KEY, queryFn: whiteLabelApi.mine })
  const [requesting, setRequesting] = useState(false)

  const latest = requests?.[0]
  const approved = requests?.find((r) => r.status === 'approved')

  // Close the form once a new request has been sent
  useEffect(() => {
    if (latest?.status === 'pending') setRequesting(false)
  }, [latest?.id, latest?.status])

  if (isError) {
    return (
      <div className={PAGE}>
        <PageHeader title="Branding and domain" />
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      </div>
    )
  }

  if (isLoading || !requests) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  if (approved) {
    return (
      <BrandingSettings
        approved={approved}
        latest={latest!}
        requesting={requesting}
        onRequestChange={() => setRequesting(true)}
        onCancelRequest={() => setRequesting(false)}
      />
    )
  }

  const prefill = latest
    ? {
        brand_name: latest.brand_name,
        requested_domain: latest.requested_domain,
        logo_url: latest.logo_url,
        primary_color: latest.primary_color,
        accent_color: latest.accent_color,
        remove_watermark: latest.remove_watermark,
      }
    : undefined

  return (
    <div className={PAGE}>
      <PageHeader
        title="Branding and domain"
        description="Put your own name, logo, colours and domain on registration pages and passes. White-label is approved by the Eventlaya team."
      />

      {!latest && (
        <>
          <WhatYouGet />
          <RequestForm />
        </>
      )}

      {latest?.status === 'pending' && <PendingNotice r={latest} />}

      {latest?.status === 'rejected' && (
        <>
          <RejectedNotice r={latest} onRetry={() => setRequesting(true)} retrying={requesting} />
          {requesting ? (
            <RequestForm
              key={latest.id}
              initial={prefill}
              title="Request white-label again"
              description="We’ve filled in your last request. Update it based on the reason above, then send it."
              onCancel={() => setRequesting(false)}
            />
          ) : (
            <Card>
              <CardHeader title="What you asked for" />
              <div className="p-5">
                <RequestSummary r={latest} />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Approved: live settings                                              */

const BrandingSettings: React.FC<{
  approved: WhiteLabelRequest
  latest: WhiteLabelRequest
  requesting: boolean
  onRequestChange: () => void
  onCancelRequest: () => void
}> = ({ approved, latest, requesting, onRequestChange, onCancelRequest }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const formId = useId()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tenantBranding'],
    queryFn: api.getTenantBranding,
  })

  const [branding, setBranding] = useState<TenantBranding | null>(null)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (data) setBranding(data)
  }, [data])

  useEffect(() => {
    if (isError) toast.error('Couldn’t load your branding', error?.message || 'Check your connection and try again.')
  }, [isError, error, toast])

  const dirty = useMemo(() => Boolean(data && branding && JSON.stringify(data) !== JSON.stringify(branding)), [data, branding])

  if (isError) {
    return (
      <div className={PAGE}>
        <ErrorState message={error?.message} onRetry={refetch} />
      </div>
    )
  }

  if (isLoading || !branding || !data) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Skeleton className="h-96 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
          <Skeleton className="h-[480px] rounded-2xl" />
        </div>
      </div>
    )
  }

  const set = <K extends keyof TenantBranding>(key: K, value: TenantBranding[K]) => setBranding((b) => (b ? { ...b, [key]: value } : b))

  const save = async (): Promise<boolean> => {
    if (!HEX.test(branding.primary_color) || !HEX.test(branding.accent_color)) {
      toast.error('Check your colours', 'Use a 6-digit hex code like #C2215A.')
      return false
    }
    setSaving(true)
    try {
      const updated = await api.updateTenantBranding(branding)
      queryClient.setQueryData(['tenantBranding'], updated)
      setBranding(updated)
      return true
    } catch (err) {
      toast.error('Couldn’t save your branding', err instanceof Error ? err.message : 'Try again in a moment.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (await save()) toast.success('Branding saved')
  }

  const handleVerify = async () => {
    if (dirty && !(await save())) return
    setVerifying(true)
    try {
      const res = await api.verifyTenantDomain()
      const next = { ...branding, is_domain_verified: res.is_domain_verified, ssl_active: res.ssl_active, cname_target: res.cname_target, status: res.status }
      queryClient.setQueryData(['tenantBranding'], next)
      setBranding(next)
      if (res.status.custom_domain?.live) toast.success('Your domain is live', res.message)
      else if (res.is_domain_verified) toast.info('DNS verified', res.message)
      else toast.info('Not verified yet', res.message)
    } catch (err) {
      toast.error('Couldn’t check the domain', err instanceof Error ? err.message : 'Try again in a moment.')
    } finally {
      setVerifying(false)
    }
  }

  const customDomain = data.custom_domain?.trim() || ''
  const status = data.status
  // Clients use their own domain; the free *.eventlaya.com address only shows when the platform turns it on
  const subdomainsOn = status?.subdomain.available ?? false
  const siteHost = customDomain || (status?.site_url ? new URL(status.site_url).host : subdomainsOn ? `${branding.subdomain || 'your-org'}.eventlaya.com` : 'events.your-domain.com')
  const pendingChange = latest.status === 'pending' && latest.id !== approved.id ? latest : null
  const rejectedChange = latest.status === 'rejected' && latest.id !== approved.id ? latest : null

  return (
    <div className={PAGE}>
      <PageHeader
        title="Branding and domain"
        description="Show your own logo, colours and domain on registration pages and passes."
        actions={
          <Button type="submit" form={formId} loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        }
      />

      <ApprovedBanner r={approved} />
      {pendingChange && <PendingNotice r={pendingChange} changeRequest />}
      {rejectedChange && !requesting && <RejectedNotice r={rejectedChange} onRetry={onRequestChange} retrying={false} />}
      {requesting && (
        <RequestForm
          initial={{
            brand_name: branding.brand_name,
            requested_domain: customDomain,
            logo_url: branding.brand_logo,
            primary_color: branding.primary_color,
            accent_color: branding.accent_color,
            remove_watermark: approved.remove_watermark,
          }}
          title="Request a change"
          description="Changing your domain or footer needs a new review. Your current settings stay live until it’s approved."
          onCancel={onCancelRequest}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form id={formId} onSubmit={handleSave} className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Your brand" description="Used on your event pages, emails and passes." />
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Organization name" required value={branding.brand_name} onChange={(e) => set('brand_name', e.target.value)} placeholder="Eastern Youth Summit" />
                <Input
                  label="Support email"
                  type="email"
                  value={branding.support_email}
                  onChange={(e) => set('support_email', e.target.value)}
                  placeholder="support@yourdomain.com"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
                <ImageUpload
                  label="Logo"
                  kind="logo"
                  shape="square"
                  value={branding.brand_logo || null}
                  onChange={(url) => set('brand_logo', url ?? '')}
                  hint="Square PNG or JPG"
                />
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorField label="Primary colour" hint="Buttons and headers" value={branding.primary_color} onChange={(v) => set('primary_color', v)} />
                    <ColorField label="Accent colour" hint="Badges and highlights" value={branding.accent_color} onChange={(v) => set('accent_color', v)} />
                  </div>
                  <Input
                    label="Footer text"
                    value={branding.footer_text}
                    onChange={(e) => set('footer_text', e.target.value)}
                    placeholder="Organized by Eastern Youth Summit, Dharan"
                  />
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 border-t border-ink-100 pt-5">
                <div>
                  <p id="watermark-label" className="text-sm font-medium text-ink-900">
                    Hide “Powered by Eventlaya”
                  </p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {approved.remove_watermark
                      ? 'Show only your own branding in the page footer.'
                      : 'Not part of your approved white-label. Request a change to add it.'}
                  </p>
                </div>
                <Switch
                  checked={branding.remove_watermark}
                  onChange={(v) => set('remove_watermark', v)}
                  labelledBy="watermark-label"
                  disabled={!approved.remove_watermark}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Domain"
              description="Where attendees open your registration pages."
              actions={
                !requesting &&
                !pendingChange && (
                  <Button variant="secondary" size="sm" onClick={onRequestChange}>
                    Request a change
                  </Button>
                )
              }
            />
            <div className="space-y-5 p-5">
              {subdomainsOn && (
                <div className="space-y-1.5">
                  <label htmlFor="subdomain" className="block text-sm font-medium text-ink-800">
                    Eventlaya address
                  </label>
                  <div className="flex">
                    <input
                      id="subdomain"
                      value={branding.subdomain}
                      onChange={(e) => set('subdomain', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder="your-org"
                      className={cn(controlClass, 'min-w-0 rounded-r-none font-mono')}
                    />
                    <span className="inline-flex shrink-0 items-center rounded-r-[10px] border border-l-0 border-ink-200 bg-ink-50 px-3 font-mono text-sm text-ink-500">
                      .eventlaya.com
                    </span>
                  </div>
                </div>
              )}

              {status ? (
                <DomainStatusPanel status={status} onCheck={customDomain ? handleVerify : undefined} checking={verifying} />
              ) : (
                <p className="text-sm text-ink-500">Custom domain: {customDomain || 'none approved'}</p>
              )}
              <p className="text-xs text-ink-500">Your custom domain is approved by the Eventlaya team. To use a different one, request a change.</p>
            </div>
          </Card>
        </form>

        <aside aria-label="Preview" className="min-w-0">
          <div className="space-y-3 lg:sticky lg:top-6">
            <p className="text-sm font-medium text-ink-500">Preview</p>
            <Preview branding={branding} host={siteHost} secure={Boolean(status?.site_url)} />
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const Preview: React.FC<{ branding: TenantBranding; host: string; secure: boolean }> = ({ branding, host, secure }) => {
  const primary = HEX.test(branding.primary_color) ? branding.primary_color : '#C2215A'
  const accent = HEX.test(branding.accent_color) ? branding.accent_color : '#E39400'
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1 font-mono text-xs text-ink-600">
          {secure ? <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> : <Globe className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />}
          <span className="truncate">{host}</span>
        </div>
      </div>

      <div className="space-y-4 bg-ink-50/60 p-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-2xs">
          <div className="flex min-w-0 items-center gap-2">
            <LogoThumb src={branding.brand_logo} name={branding.brand_name} color={primary} className="h-7 w-7 text-xs" />
            <span className="truncate text-sm font-bold text-ink-900">{branding.brand_name || 'Your organization'}</span>
          </div>
          <span className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white" style={{ backgroundColor: primary }}>
            Register
          </span>
        </div>

        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: primary }}>
          <p className="font-display text-base font-bold leading-snug">Annual Technology and Innovation Summit</p>
          <p className="mt-1 text-xs text-white/85">Dharan Chamber of Commerce Auditorium, 28 March</p>
          <span className="mt-3 inline-block rounded-lg bg-white px-3 py-1 text-xs font-semibold text-ink-900">Get your pass</span>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-3.5">
          <div className="flex items-start justify-between gap-3 border-b border-dashed border-ink-200 pb-2.5">
            <div>
              <p className="text-xs text-ink-500">Attendee pass</p>
              <p className="text-sm font-bold text-ink-900">Subash Dahal</p>
            </div>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
              VIP
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 pt-2.5">
            <p className="font-mono text-xs text-ink-700">TKT-EAST-0042</p>
            <QrCode className="h-10 w-10 text-ink-900" aria-hidden />
          </div>
        </div>

        <div className="space-y-0.5 text-center text-xs text-ink-500">
          {branding.footer_text && <p>{branding.footer_text}</p>}
          {!branding.remove_watermark && <p>Powered by Eventlaya</p>}
          {branding.support_email && <p>{branding.support_email}</p>}
        </div>
      </div>
    </div>
  )
}
