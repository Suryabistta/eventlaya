/**
 * Google Analytics 4 (and optional Cloudflare Web Analytics) for eventlaya.com — privacy-first, configured by the
 * superadmin in Admin → Analytics (backend apps/site_analytics). docs/analytics.md has the event list and setup.
 *
 * Nothing loads when:
 *  - this is a white-label tenant site (the client's site) or the build-time prerender;
 *  - the superadmin switched analytics off or no Measurement ID is set;
 *  - the visitor turned it off on /privacy (localStorage), or the browser sends Do Not Track / Global Privacy Control.
 *
 * What is sent: page views on route changes with a sanitized URL and title (lib/analytics-url.ts: pass tokens,
 * reset links, payment data, emails, phone numbers and OTP codes are removed) and a few events via track().
 * Never names, emails or phone numbers. Google signals, ad personalization and ad storage are off.
 * Signed-in pages (/app, /admin, /judge) are measured only if the superadmin turns that on.
 *
 * Keep this module imported from App.tsx (main bundle): a separate chunk named "analytics-…" could be blocked by
 * ad blockers and take the importing page down with it.
 */
import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { TENANT_HOST } from './tenant-host'
import { isAppPath, pageTitleFor, sanitizeParams, sanitizeUrl, scrubText } from './analytics-url'

export interface AnalyticsConfig {
  enabled: boolean
  measurement_id: string
  track_app_pages: boolean
  cloudflare_token: string
}

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
    [key: `ga-disable-${string}`]: boolean | undefined
  }
  interface Navigator {
    globalPrivacyControl?: boolean
    msDoNotTrack?: string
  }
}

const PREF_KEY = 'eventlaya:analytics'
const DEBUG_KEY = 'eventlaya:analytics-debug'
const SENT_PREFIX = 'eventlaya:analytics-sent:'
const CONFIG_URL = '/api/site/config/'
/** How long to wait for the page's real title (lib/seo.tsx marks the head as ready) before sending the view */
const TITLE_WAIT_MS = 2500
/** After leaving the measured pages, events already queued for the last page still go out before GA is paused */
const PAUSE_DELAY_MS = 2000

export type AnalyticsPreference = 'on' | 'off'
/** Why analytics is not running for this visitor (null = it is, or would be if configured) */
export type AnalyticsBlock = 'tenant' | 'prerender' | 'do-not-track' | 'global-privacy-control' | 'opted-out' | null

const state: {
  config: AnalyticsConfig | null
  configPromise: Promise<AnalyticsConfig | null> | null
  gaLoaded: boolean
  cfLoaded: boolean
  /** The current page may be measured (public, or app pages allowed) */
  measured: boolean
  location: string
  referrer: string
  pauseTimer: ReturnType<typeof setTimeout> | null
  queue: [string, Record<string, unknown>][]
} = {
  config: null,
  configPromise: null,
  gaLoaded: false,
  cfLoaded: false,
  measured: true,
  location: '',
  referrer: '',
  pauseTimer: null,
  queue: [],
}

/* ------------------------------------------------------------------ */
/* Visitor choice and browser signals                                  */

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function getAnalyticsPreference(): AnalyticsPreference | null {
  try {
    const v = storage('local')?.getItem(PREF_KEY)
    return v === 'on' || v === 'off' ? v : null
  } catch {
    return null
  }
}

/** Why analytics can't run in this browser regardless of the site settings (null if it can). */
export function analyticsBlock(): AnalyticsBlock {
  if (TENANT_HOST) return 'tenant'
  if (typeof navigator === 'undefined' || /EventlayaPrerender/i.test(navigator.userAgent)) return 'prerender'
  if (getAnalyticsPreference() === 'off') return 'opted-out'
  if (navigator.globalPrivacyControl === true) return 'global-privacy-control'
  const dnt = navigator.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack ?? navigator.msDoNotTrack
  if (dnt === '1' || dnt === 'yes') return 'do-not-track'
  return null
}

/** The visitor's switch on /privacy. Off: GA stops at once, its cookies are deleted, nothing loads next time. */
export function setAnalyticsPreference(pref: AnalyticsPreference) {
  try {
    storage('local')?.setItem(PREF_KEY, pref)
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  const id = state.config?.measurement_id
  if (pref === 'off') {
    if (id) window[`ga-disable-${id}`] = true
    state.queue = []
    deleteGaCookies()
  } else {
    if (id) window[`ga-disable-${id}`] = !state.measured
    void startAnalytics()
  }
  window.dispatchEvent(new Event('eventlaya:analytics-preference'))
}

function deleteGaCookies() {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid' || n === '_gat')
  const host = window.location.hostname
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`]
  for (const name of names)
    for (const domain of domains)
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ''}`
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */

function loadConfig(): Promise<AnalyticsConfig | null> {
  if (!state.configPromise) {
    state.configPromise = fetch(CONFIG_URL, { credentials: 'omit', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsConfig>) : null))
      .catch(() => null)
      .then((cfg) => {
        state.config = cfg
        return cfg
      })
  }
  return state.configPromise
}

function debugMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  const flag = params.get('debug_mode') ?? params.get('ga_debug')
  const store = storage('session')
  try {
    if (flag === '1' || flag === 'true') store?.setItem(DEBUG_KEY, '1')
    else if (flag === '0' || flag === 'false') store?.removeItem(DEBUG_KEY)
    return store?.getItem(DEBUG_KEY) === '1'
  } catch {
    return flag === '1' || flag === 'true'
  }
}

/** Only the area of an unmeasured signed-in page (…/app), never its details. */
function areaOf(pathname: string) {
  return `${window.location.origin}/${pathname.split('/')[1] || ''}`
}

/** Coming back from the payment page is not a new visit from Khalti / eSewa. */
const PAYMENT_HOSTS = /(^|\.)(khalti\.com|esewa\.com\.np|fonepay\.com)$/i

/** The referrer, sanitized; an unmeasured signed-in page of this site counts as just its area. */
function cleanReferrer(referrer: string) {
  if (!referrer) return ''
  const clean = sanitizeUrl(referrer)
  try {
    const url = new URL(referrer)
    if (PAYMENT_HOSTS.test(url.hostname)) return ''
    if (url.origin === window.location.origin && isAppPath(url.pathname) && !state.config?.track_app_pages) return areaOf(url.pathname)
  } catch {
    /* not a URL */
  }
  return clean.location
}

function currentPage() {
  const clean = sanitizeUrl(window.location.href, window.location.origin)
  return { ...clean, title: pageTitleFor(window.location.pathname, document.title) }
}

function loadGa(id: string) {
  if (state.gaLoaded) return
  state.gaLoaded = true
  window.dataLayer = window.dataLayer || []
  // gtag.js expects the `arguments` object itself
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  const gtag = window.gtag
  window[`ga-disable-${id}`] = !state.measured
  // No advertising: Google signals, ad storage, ad personalization and user data for ads are off
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    personalization_storage: 'denied',
    analytics_storage: 'granted',
    functionality_storage: 'granted',
    security_storage: 'granted',
  })
  gtag('set', 'ads_data_redaction', true)
  gtag('set', 'allow_google_signals', false)
  gtag('set', 'allow_ad_personalization_signals', false)
  gtag('js', new Date())
  const page = currentPage()
  state.location = page.location
  const referrer = cleanReferrer(document.referrer)
  state.referrer = referrer
  gtag('config', id, {
    // page views are sent by <AnalyticsTracker /> with a sanitized URL
    send_page_view: false,
    page_location: page.location,
    page_referrer: referrer,
    page_title: page.title,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    allow_enhanced_conversions: false,
    cookie_flags: 'SameSite=Lax;Secure',
    ...(debugMode() ? { debug_mode: true } : {}),
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  script.setAttribute('data-analytics', 'ga4')
  script.addEventListener('load', guardAutoEvents)
  document.head.appendChild(script)
}

/**
 * GA's enhanced measurement (all on by default in a new GA4 web stream) reads raw URLs in two places:
 *  - "Page changes based on browser history events" sends its own page_view on every in-app navigation with the
 *    raw old and new URL (pass tokens, payment data, emails), even with send_page_view: false;
 *  - "Form interactions" sends form_start / form_submit with form_destination = the form's action, which for our
 *    forms is the raw page URL.
 * gtag.js reports both by pushing {event: 'gtm.historyChange-v2' | 'gtm.formInteract' | 'gtm.formSubmit', …} into
 * window.dataLayer. We drop those, so only our sanitized page_view counts (no duplicates, nothing raw); scroll,
 * outbound-click, download and video measurements keep working. Turning both settings off in GA is still advised.
 */
const BLOCKED_AUTO_EVENTS = /^gtm\.(historyChange|formInteract|formSubmit)/

function guardAutoEvents() {
  const layer = window.dataLayer as (unknown[] & { push: (...items: unknown[]) => number; __eventlayaGuard?: boolean }) | undefined
  if (!layer || layer.__eventlayaGuard) return
  const gaPush = layer.push
  layer.push = function push(this: unknown, ...items: unknown[]) {
    const kept = items.filter((item) => {
      const event = item && typeof item === 'object' && !('length' in item) ? (item as { event?: unknown }).event : undefined
      return !(typeof event === 'string' && BLOCKED_AUTO_EVENTS.test(event))
    })
    return kept.length ? gaPush.apply(layer, kept) : layer.length
  }
  layer.__eventlayaGuard = true
}

/**
 * Cloudflare Web Analytics (cookieless). It records URLs itself, so it only loads when the first page is public and
 * carries nothing secret, and only counts that full page load (spa: false): in-app navigation could reach a pass link.
 */
function loadCloudflare(token: string, config: AnalyticsConfig) {
  if (state.cfLoaded || !token) return
  const { pathname } = window.location
  if (isAppPath(pathname) && !config.track_app_pages) return
  const clean = sanitizeUrl(window.location.href, window.location.origin)
  const query = clean.location.split('?')[1] ?? ''
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  if (clean.path !== path || /=redacted(&|$)|redacted_param/.test(query)) return // something secret in the URL
  state.cfLoaded = true
  const script = document.createElement('script')
  script.defer = true
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: false }))
  script.setAttribute('data-analytics', 'cloudflare')
  document.head.appendChild(script)
}

/** Fetches the site settings and loads what is allowed. Safe to call more than once. */
export async function startAnalytics(): Promise<boolean> {
  if (analyticsBlock()) return false
  const config = await loadConfig()
  if (!config?.enabled || analyticsBlock()) {
    state.queue = []
    return false
  }
  state.measured = !isAppPath(window.location.pathname) || config.track_app_pages
  if (config.measurement_id) loadGa(config.measurement_id)
  if (config.cloudflare_token) loadCloudflare(config.cloudflare_token, config)
  flushQueue()
  return state.gaLoaded
}

/** True when GA is loaded and the current page is measured. */
function active(): boolean {
  return state.gaLoaded && state.measured && !!window.gtag && !analyticsBlock()
}

function flushQueue() {
  const queued = state.queue
  state.queue = []
  if (!active()) return
  for (const [name, params] of queued) send(name, params)
}

function send(name: string, params: Record<string, unknown>) {
  const page = currentPage()
  window.gtag!('event', name, sanitizeParams({ ...params, page_location: page.location, page_title: page.title }))
}

/* ------------------------------------------------------------------ */
/* Events                                                              */

/**
 * Sends a GA4 event. No-op when analytics is off, blocked or on an unmeasured page. Parameters are sanitized
 * (no names, emails, phone numbers; see analytics-url.ts) — still, only pass IDs, slugs, counts and amounts.
 */
export function track(name: string, params: Record<string, unknown> = {}) {
  try {
    if (analyticsBlock()) return
    if (!state.config && state.configPromise === null) return // AnalyticsTracker not mounted (tests, tenant)
    if (!state.config) {
      // settings still loading: keep a few events for a moment
      if (state.queue.length < 20) state.queue.push([name, params])
      return
    }
    if (active()) send(name, params)
  } catch {
    /* analytics must never break the page */
  }
}

/** track() at most once per browser tab for `key` (e.g. one purchase per order, even after a reload). */
export function trackOnce(key: string, name: string, params: Record<string, unknown> = {}) {
  const store = storage('session')
  const k = `${SENT_PREFIX}${key}`
  try {
    if (store?.getItem(k)) return
    store?.setItem(k, '1')
  } catch {
    /* no storage: send anyway */
  }
  track(name, params)
}

/** GA4 `items` for a set of passes: one line per ticket type with its quantity and unit price. */
export function ticketItems(tickets: { ticket_type?: string | null; ticket_type_name?: string; price?: string | number | null }[]) {
  const lines = new Map<string, { item_id: string; item_name: string; item_category: string; price: number; quantity: number }>()
  for (const t of tickets) {
    const id = t.ticket_type || 'general'
    const price = Number(t.price ?? 0) || 0
    const key = `${id}:${price}`
    const line = lines.get(key)
    if (line) line.quantity += 1
    else lines.set(key, { item_id: id, item_name: t.ticket_type_name || 'Ticket', item_category: 'ticket', price, quantity: 1 })
  }
  return [...lines.values()]
}

/** Payment confirmed by the server for a ticket order: GA4 `purchase` + `register_event`, once per order. */
export function trackTicketPurchase(order: { reference?: string; total?: string | number }, amount: string | number, eventSlug: string,
  tickets: Parameters<typeof ticketItems>[0], provider?: string | null) {
  const reference = order.reference || ''
  const value = Number(amount ?? order.total ?? 0) || 0
  trackOnce(`purchase:${reference}`, 'purchase', {
    transaction_id: reference, value, currency: 'NPR', event_slug: eventSlug, payment_type: provider || 'online',
    items: ticketItems(tickets),
  })
  trackOnce(`register:${reference}`, 'register_event', { event_slug: eventSlug, ticket_count: tickets.length, value, currency: 'NPR', payment: 'online' })
}

/** Share buttons: a click handler for a container of share links/buttons (method = the button's label). */
export function shareClickTracker(contentType: string, itemId: string) {
  return (e: React.MouseEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement | null)?.closest('a,button')
    if (!el) return
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase()
    const method = label.includes('copy') ? 'copy_link' : label.replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'other'
    if (/download/.test(method)) return
    track('share', { method: method === 'share' ? 'native' : method, content_type: contentType, item_id: itemId })
  }
}

/** `search` once the visitor stops typing (1.5 s), at most once per term and area. */
export function useTrackSearch(term: string, area: string) {
  useEffect(() => {
    const clean = scrubText(term, 80)
    if (clean.length < 2) return
    const t = setTimeout(() => {
      const key = `${area}:${clean.toLowerCase()}`
      if (lastSearch.has(key)) return
      lastSearch.add(key)
      track('search', { search_term: clean, search_area: area })
    }, 1500)
    return () => clearTimeout(t)
  }, [term, area])
}
const lastSearch = new Set<string>()

/* ------------------------------------------------------------------ */
/* Page views                                                          */

/**
 * The route changed: pause GA on unmeasured pages, otherwise point GA at the new page's clean URL at once, so its
 * own measurements (scroll, outbound clicks) on this page use it. Returns whether the page is measured.
 */
function routeChanged(pathname: string): boolean {
  if (!state.config) return false
  const allowed = !isAppPath(pathname) || state.config.track_app_pages
  const id = state.config.measurement_id
  if (state.pauseTimer) {
    clearTimeout(state.pauseTimer)
    state.pauseTimer = null
  }
  if (!allowed) {
    // Pause GA on signed-in pages (after a moment, so events from the last public page still go out)
    if (id && state.measured) state.pauseTimer = setTimeout(() => (window[`ga-disable-${id}`] = true), PAUSE_DELAY_MS)
    state.measured = false
    // the next public page's referrer: just "/app", not which screen
    if (state.location) state.location = areaOf(pathname)
    return false
  }
  state.measured = true
  if (id) window[`ga-disable-${id}`] = getAnalyticsPreference() === 'off'
  if (!active()) return false
  const location = sanitizeUrl(window.location.href, window.location.origin).location
  if (location !== state.location) {
    state.referrer = state.location
    state.location = location
  }
  window.gtag!('set', { page_location: state.location, page_referrer: state.referrer })
  return true
}

/** page_view for the current page, once its title is known. */
function sendPageView(pathname: string) {
  if (!active() || window.location.pathname !== pathname) return
  const fields = { page_location: state.location, page_referrer: state.referrer, page_title: pageTitleFor(pathname, document.title) }
  window.gtag!('set', { page_title: fields.page_title })
  window.gtag!('event', 'page_view', sanitizeParams(fields))
}

/**
 * Sends a sanitized page_view on every route change. Mount once inside the router (App.tsx, next to <SeoHead />).
 * Waits briefly for the page's title (lib/seo.tsx sets data-seo-path when the head is final).
 */
export const AnalyticsTracker: React.FC = () => {
  const { pathname, search } = useLocation()

  useEffect(() => {
    void startAnalytics()
  }, [])

  useEffect(() => {
    if (analyticsBlock()) return
    let cancelled = false
    let measured = false
    // GA itself is loaded by startAnalytics (registered first on the same promise, so it runs first)
    const routed = loadConfig().then(() => {
      if (!cancelled && window.location.pathname === pathname) measured = routeChanged(pathname)
    })
    const started = Date.now()
    const tick = () => {
      if (cancelled) return
      const ready = document.documentElement.dataset.seoPath === pathname
      if (!ready && Date.now() - started < TITLE_WAIT_MS) {
        setTimeout(tick, 100)
        return
      }
      void routed.then(() => {
        if (!cancelled && measured) sendPageView(pathname)
      })
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [pathname, search])

  return null
}

/** For the /privacy switch: the visitor's choice and what blocks analytics in this browser. */
export function useAnalyticsChoice() {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    window.addEventListener('eventlaya:analytics-preference', force)
    return () => window.removeEventListener('eventlaya:analytics-preference', force)
  }, [])
  const block = analyticsBlock()
  return {
    preference: getAnalyticsPreference(),
    block,
    /** The visitor sees "on" unless they or their browser said no */
    on: block === null,
    set: setAnalyticsPreference,
  }
}
