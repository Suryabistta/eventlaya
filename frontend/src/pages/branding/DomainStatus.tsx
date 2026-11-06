import React from 'react'
import { AlertTriangle, CheckCircle2, Circle, Copy, ExternalLink, Globe, Loader2, Lock, RefreshCw } from 'lucide-react'
import type { TenantDomainStatus } from '@/services/api'
import { Badge, Button, IconButton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

type Step = 'done' | 'current' | 'waiting' | 'problem'

const ago = (iso: string | null) => {
  if (!iso) return 'not yet'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** One-line badge for tables: Live / Waiting for DNS / SSL pending / No custom domain. */
export const DomainBadge: React.FC<{ status?: TenantDomainStatus | null }> = ({ status }) => {
  const c = status?.custom_domain
  if (!status?.active) return <Badge tone="danger">Site off</Badge>
  if (!c) return status.subdomain.live ? <Badge tone="success">Subdomain live</Badge> : <Badge tone="neutral">No custom domain</Badge>
  if (c.stage === 'live')
    return (
      <Badge tone="success">
        <Lock className="h-3.5 w-3.5" aria-hidden /> Live
      </Badge>
    )
  if (c.stage === 'ssl') return <Badge tone="warning">DNS ok, HTTPS pending</Badge>
  return <Badge tone="warning">Waiting for DNS</Badge>
}

const StepItem: React.FC<{ state: Step; title: string; detail: string }> = ({ state, title, detail }) => (
  <li className="flex min-w-0 flex-1 gap-2.5">
    <span className="mt-0.5 shrink-0" aria-hidden>
      {state === 'done' ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
      ) : state === 'current' ? (
        <Loader2 className="h-5 w-5 text-marigold-600" />
      ) : state === 'problem' ? (
        <AlertTriangle className="h-5 w-5 text-red-600" />
      ) : (
        <Circle className="h-5 w-5 text-ink-300" />
      )}
    </span>
    <span className="min-w-0">
      <span className={cn('block text-sm font-semibold', state === 'waiting' ? 'text-ink-500' : 'text-ink-900')}>{title}</span>
      <span className="block text-xs text-ink-500">{detail}</span>
    </span>
  </li>
)

/**
 * Where the white-label site lives and how far the custom domain got: DNS → HTTPS → live.
 * Used by the organizer (Branding and domain) and the superadmin (White-label tenants).
 */
export const DomainStatusPanel: React.FC<{
  status: TenantDomainStatus
  onCheck?: () => void
  checking?: boolean
  /** Superadmin: provider details and manual-mode instructions */
  admin?: boolean
}> = ({ status, onCheck, checking, admin }) => {
  const toast = useToast()
  const c = status.custom_domain
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`, value)
    } catch {
      toast.error('Couldn’t copy', value)
    }
  }

  const dnsStep: Step = !c ? 'waiting' : c.dns_verified ? 'done' : c.dns_checked_at ? 'problem' : 'current'
  const sslStep: Step = !c?.dns_verified ? 'waiting' : c.ssl_active ? 'done' : 'current'
  const liveStep: Step = c?.live ? 'done' : 'waiting'
  const message = !c ? '' : c.live ? `Your site is live at ${c.url}` : c.dns_verified ? c.provider_message : c.dns_message

  return (
    <div className="space-y-5">
      {!status.active && (
        <p role="status" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {status.module_enabled
            ? 'White-label isn’t active for this organization, so its site is not served.'
            : 'White-label sites are switched off by the platform right now, so this site is not served.'}
        </p>
      )}

      {/* Free address — only when the platform has *.eventlaya.com addresses switched on */}
      {status.subdomain.available && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-500">Free Eventlaya address</p>
            <p className="truncate font-mono text-sm text-ink-900">{status.subdomain.host ?? '—'}</p>
          </div>
          {status.subdomain.live && status.subdomain.url ? (
            <a href={status.subdomain.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )}
        </div>
      )}

      {c ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 font-mono text-sm text-ink-900">
              <Globe className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <span className="truncate">{c.host}</span>
            </p>
            <DomainBadge status={status} />
          </div>

          <ol className="flex flex-col gap-3 rounded-xl border border-ink-200 bg-ink-50/60 p-4 sm:flex-row sm:gap-4" aria-label="Setup progress">
            <StepItem state={dnsStep} title="1. DNS records" detail={c.dns_verified ? 'Found and verified' : 'Add the records below'} />
            <StepItem
              state={sslStep}
              title="2. HTTPS certificate"
              detail={c.ssl_active ? 'Issued, renews automatically' : c.dns_verified ? 'Being issued' : 'After DNS'}
            />
            <StepItem state={liveStep} title="3. Live" detail={c.live ? 'Visitors can open it' : 'Not yet'} />
          </ol>

          {message && (
            <p
              role="status"
              className={cn(
                'rounded-xl border px-4 py-3 text-sm',
                c.live ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-marigold-200 bg-marigold-50 text-marigold-900',
              )}
            >
              {message}
            </p>
          )}

          <div>
            <h3 className="text-sm font-semibold text-ink-900">{c.live ? 'DNS records (keep these in place)' : 'Add these DNS records'}</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              At the company that runs the domain’s DNS (Cloudflare, GoDaddy, Mercantile …). Most panels want only the short name in the
              Name box. DNS changes can take up to an hour.
            </p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-ink-50 text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Type</th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {c.records.map((r) => (
                    <tr key={r.type}>
                      <td className="px-3 py-2.5 align-top font-mono font-semibold text-ink-900">{r.type}</td>
                      <td className="px-3 py-2.5 align-top">
                        <span className="flex items-center gap-1">
                          <span className="break-all font-mono text-ink-900">{r.host}</span>
                          <IconButton label={`Copy ${r.type} name`} onClick={() => void copy('Name', r.host)} className="h-7 w-7 shrink-0">
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          </IconButton>
                        </span>
                        <span className="block break-all text-xs text-ink-500">{r.name}</span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className="flex items-center gap-1">
                          <span className="break-all font-mono text-ink-900">{r.value}</span>
                          <IconButton label={`Copy ${r.type} value`} onClick={() => void copy('Value', r.value)} className="h-7 w-7 shrink-0">
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          </IconButton>
                        </span>
                        <span className="block text-xs text-ink-500">{r.purpose}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              If your DNS is on Cloudflare, set the CNAME to “DNS only” (grey cloud). TTL: Auto.
            </p>
          </div>

          {admin && (
            <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-ink-200 px-4 py-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-500">Certificates</dt>
                <dd className="text-ink-900">{status.mode === 'cloudflare' ? 'Cloudflare for SaaS (automatic)' : 'Manual (Cloudflare dashboard)'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Cloudflare hostname / SSL</dt>
                <dd className="font-mono text-ink-900">
                  {c.provider_status || '—'} / {c.provider_ssl_status || '—'}
                </dd>
              </div>
              {c.provider_hostname_id && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-ink-500">Custom hostname id</dt>
                  <dd className="break-all font-mono text-xs text-ink-700">{c.provider_hostname_id}</dd>
                </div>
              )}
              {status.mode === 'manual' && c.dns_verified && !c.ssl_active && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-ink-500">To do (manual mode)</dt>
                  <dd className="text-ink-800">
                    In Cloudflare → eventlaya.com → SSL/TLS → Custom Hostnames, add <span className="font-mono">{c.host}</span> (HTTP
                    validation), wait until it shows Active, then select Check now.
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          No custom domain approved yet. Request your own domain (for example events.your-organization.com) and we’ll show the DNS
          records to add.
        </p>
      )}

      {c && onCheck && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <p className="text-xs text-ink-500">Last checked {ago(c.dns_checked_at)}. We also re-check every few minutes.</p>
          <Button variant={c.live ? 'secondary' : 'primary'} size="sm" icon={<RefreshCw className="h-4 w-4" aria-hidden />} loading={checking} onClick={onCheck}>
            Check now
          </Button>
        </div>
      )}
    </div>
  )
}
