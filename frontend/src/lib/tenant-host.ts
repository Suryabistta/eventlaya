/**
 * Which white-label site (if any) this page load is for. No imports: services/api.ts uses it for every request.
 *
 * - eventlaya.com, www, api, localhost, IP addresses → the normal Eventlaya site (null)
 * - <name>.eventlaya.com or any other hostname (event.dharanfilmfestival.org) → tenant mode for that host
 * - Dev override: ?tenant=event.dharanfilmfestival.org (kept for the browser tab in sessionStorage);
 *   ?tenant=off clears it.
 */

const PLATFORM_DOMAIN = (import.meta.env.VITE_PLATFORM_DOMAIN as string | undefined) || 'eventlaya.com'
const PLATFORM_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'tenants', 'cname', 'mail', 'staging', 'dev'])
const EXTRA_PLATFORM_HOSTS = ((import.meta.env.VITE_PLATFORM_HOSTS as string | undefined) || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
const OVERRIDE_KEY = 'eventlaya:tenant-host'

function isPlatformHost(host: string): boolean {
  if (!host || host === 'localhost' || host === PLATFORM_DOMAIN || EXTRA_PLATFORM_HOSTS.includes(host)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.localhost')) return true
  if (host.endsWith(`.${PLATFORM_DOMAIN}`)) {
    const label = host.slice(0, -PLATFORM_DOMAIN.length - 1)
    return PLATFORM_SUBDOMAINS.has(label) || label.includes('.')
  }
  return false
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function detect(): { host: string | null; override: boolean } {
  if (typeof window === 'undefined') return { host: null, override: false }
  const params = new URLSearchParams(window.location.search)
  const param = params.get('tenant')
  const store = storage()
  if (param !== null) {
    const value = param.trim().toLowerCase()
    try {
      if (!value || value === 'off') store?.removeItem(OVERRIDE_KEY)
      else store?.setItem(OVERRIDE_KEY, value)
    } catch {
      /* private mode */
    }
  }
  let saved: string | null = null
  try {
    saved = store?.getItem(OVERRIDE_KEY) ?? null
  } catch {
    saved = null
  }
  if (saved) return { host: saved, override: true }
  const host = window.location.hostname.toLowerCase()
  return { host: isPlatformHost(host) ? null : host, override: false }
}

const detected = detect()

/** The tenant hostname for this page load, or null on the Eventlaya site. */
export const TENANT_HOST: string | null = detected.host
/** True when tenant mode comes from the ?tenant= dev override rather than the real hostname. */
export const TENANT_OVERRIDE: boolean = detected.override

/** A URL on the main Eventlaya site (organizer dashboard, sign-up, …). */
export function platformUrl(path = '/'): string {
  if (TENANT_OVERRIDE) {
    const sep = path.includes('?') ? '&' : '?'
    return `${window.location.origin}${path}${sep}tenant=off`
  }
  return `https://${PLATFORM_DOMAIN}${path}`
}
