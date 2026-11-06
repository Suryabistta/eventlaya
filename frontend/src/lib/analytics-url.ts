/**
 * What may leave the browser for Google Analytics: pure functions, no DOM and no imports, so they can be tested
 * with plain Node (`node --test scripts/test-analytics-url.mjs`). Used by lib/analytics.ts; rules in docs/analytics.md.
 *
 * Paths
 *   /ticket/<token> → /ticket/:token (also /pass, /invite, /reset-password, /verify-email, /unsubscribe sub-paths)
 *   any segment that is an email → :email, a UUID → :id, a phone-like number → :number, a random-looking token → :token
 * Query strings
 *   KEEP_PARAMS (utm_*, filters, step…) stay, with emails / long numbers / tokens inside their values masked;
 *   DROP_PARAMS (click IDs, linker, our own debug flags) are removed;
 *   every other parameter keeps its name but its value becomes "redacted" (?token=, ?uid=, ?email=, ?payment=,
 *   ?pidx=, ?data=, ?mobile=, ?code=, ?otp=, ?next=…).
 * The #fragment is always dropped (it can carry OAuth tokens).
 * Event parameters: names that hold personal data (email, phone, name…) are removed and every text value is masked
 * (…_id parameters — our UUIDs, order references, slugs — are kept unless they contain an email).
 */

/** Query parameters that are useful and harmless: kept (values still masked by scrubText). Lower-case. */
export const KEEP_PARAMS = new Set([
  'gclid', 'gbraid', 'wbraid',
  // site filters, tabs and steps
  'search', 'q', 'category', 'city', 'tag', 'type', 'when', 'page', 'sort', 'view', 'tab', 'step', 'kind', 'range',
  'month', 'day', 'plan', 'status', 'sent', 'round', 'priority', 'expiring', 'hidden', 'bookings', 'listing', 'space',
])

/** Removed completely: ad-network click IDs, Google's cross-domain linker, our own switches. Lower-case. */
export const DROP_PARAMS = new Set([
  'fbclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id', 'igshid', 'mc_eid', 'mc_cid', 'yclid', 'dclid', 'srsltid',
  '_gl', '_ga', 'gtm_debug', 'debug_mode', 'ga_debug', 'tenant',
])

/** Path prefixes whose remainder is a secret (a pass link, a reset link…). */
const SECRET_PREFIXES = ['ticket', 'pass', 'invite', 'reset-password', 'verify-email', 'unsubscribe', 'magic', 'confirm']

/** Event parameters never sent, whatever their value. Lower-case. */
const PII_PARAM_NAMES = new Set([
  'email', 'e_mail', 'mail', 'phone', 'mobile', 'tel', 'name', 'full_name', 'first_name', 'last_name', 'username',
  'address', 'otp', 'code', 'password', 'token', 'user_id', 'voter', 'voter_id', 'voter_token', 'ticket_code',
  'attendee', 'attendee_name', 'attendee_email', 'guest_names', 'destination',
])

const EMAIL_RE = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi
const HAS_EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i
/** 6+ digits, optionally with a leading + and spaces/dashes between them (phones, OTP codes, IDs) */
const LONG_NUMBER_RE = /\+?\d(?:[\s-]?\d){5,}/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A random-looking value: an access token, a hash, a signed ID. Ordinary slugs and words don't match. */
export function looksLikeToken(value: string): boolean {
  if (value.length < 16) return false
  if (!/^[A-Za-z0-9._~+/=:-]+$/.test(value)) return false
  if (/^[A-Fa-f0-9]{24,}$/.test(value)) return true // hex hashes
  if ((value.match(/\./g) || []).length >= 2 && value.length >= 40) return true // JWT-like
  const mixed = /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value)
  if (mixed && value.length >= 16) return true
  if (value.length >= 32 && !SLUG_RE.test(value)) return true
  // long slug-like strings with no vowels-and-words shape, e.g. "k3j4h5g6f7d8s9a0q1w2"
  return value.length >= 20 && /\d/.test(value) && /[a-z]/i.test(value) && !value.includes('-') && (value.match(/\d/g) || []).length >= 4
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Masks personal data and secrets inside free text (search terms, parameter values, titles):
 * emails → (email), 6+ digit numbers (phones, OTP codes) → (number), random tokens → (token). Trimmed and cut.
 */
export function scrubText(value: unknown, maxLength = 100): string {
  let text = String(value ?? '')
  // dates (2026-10-28) are not phone numbers
  text = text.replace(EMAIL_RE, '(email)').replace(LONG_NUMBER_RE, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) ? m : '(number)'))
  text = text
    .split(/(\s+)/)
    .map((word) => (looksLikeToken(word) ? '(token)' : word))
    .join('')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function sanitizeSegment(raw: string): string {
  const seg = safeDecode(raw)
  if (!seg) return raw
  if (seg.includes('@')) return ':email'
  if (UUID_RE.test(seg)) return ':id'
  if (/^\+?\d[\d\s-]{6,}$/.test(seg)) return ':number'
  if (looksLikeToken(seg)) return ':token'
  return raw
}

/** A path with secrets and personal data replaced by placeholders (see the rules at the top). */
export function sanitizePath(pathname: string): string {
  let path = (pathname || '/').split(/[?#]/)[0] || '/'
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/{2,}/g, '/')
  const segments = path.split('/').slice(1)
  const out: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (i > 0 && SECRET_PREFIXES.includes(segments[i - 1].toLowerCase()) && seg) {
      out.push(':token')
      // anything after the secret is part of it (e.g. /reset-password/<uid>/<token>)
      break
    }
    out.push(i === 0 && SECRET_PREFIXES.includes(seg.toLowerCase()) ? seg : sanitizeSegment(seg))
  }
  let result = `/${out.join('/')}`
  if (result.length > 1) result = result.replace(/\/+$/, '')
  return result || '/'
}

/** "?a=b&…" with the query rules applied ('' when nothing is left). Values are masked, unknown ones redacted. */
export function sanitizeSearch(search: string): string {
  const query = (search || '').replace(/^\?/, '').split('#')[0]
  if (!query) return ''
  const parts: string[] = []
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    const key = safeDecode(rawKey.replace(/\+/g, ' ')).trim()
    const lower = key.toLowerCase()
    if (!key || DROP_PARAMS.has(lower)) continue
    // a parameter name can itself be personal data (…?someone@example.com)
    const safeKey = HAS_EMAIL.test(key) || looksLikeToken(key) ? 'redacted_param' : key
    let value: string
    if (KEEP_PARAMS.has(lower) || lower.startsWith('utm_')) {
      value = scrubText(safeDecode(rawValue.replace(/\+/g, ' ')), 100)
    } else {
      value = rawValue === '' ? '' : 'redacted'
    }
    parts.push(`${encodeURIComponent(safeKey)}${eq === -1 ? '' : `=${encodeURIComponent(value).replace(/%20/g, '+')}`}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

export interface SanitizedUrl {
  /** Full URL for page_location / page_referrer: origin + clean path + clean query, no fragment */
  location: string
  /** Clean path without the query, e.g. /ticket/:token */
  path: string
}

/** Any URL (absolute or relative to `base`) with the path and query rules applied and the fragment dropped. */
export function sanitizeUrl(href: string, base = 'https://eventlaya.com'): SanitizedUrl {
  if (!href) return { location: '', path: '/' }
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return { location: '', path: '/' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { location: '', path: '/' }
  const path = sanitizePath(url.pathname)
  return { location: `${url.origin}${path}${sanitizeSearch(url.search)}`, path }
}

/** Signed-in areas, measured only when the superadmin turns on "Track signed-in app pages". */
export function isAppPath(pathname: string): boolean {
  return /^\/(app|admin|judge|my|superadmin)(\/|$)/.test(pathname)
}

/** Pages whose own title might describe a person or a secret: GA gets the clean path as the title instead. */
export function isSensitivePath(pathname: string): boolean {
  const first = (pathname.split('/')[1] || '').toLowerCase()
  return isAppPath(pathname) || SECRET_PREFIXES.includes(first) || ['login', 'signup', 'forgot-password'].includes(first)
}

/** page_title for GA: the document title on public pages (masked), the clean path elsewhere. */
export function pageTitleFor(pathname: string, documentTitle: string): string {
  if (isSensitivePath(pathname)) return `Eventlaya: ${sanitizePath(pathname)}`
  return scrubText(documentTitle, 150) || sanitizePath(pathname)
}

type Primitive = string | number | boolean
export type CleanParams = Record<string, Primitive | Record<string, Primitive>[]>

/**
 * Event parameters as GA may receive them: personal-data names removed, text masked, numbers kept, nested
 * objects only inside `items` (GA4 e-commerce), undefined/null dropped.
 */
export function sanitizeParams(params: Record<string, unknown>): CleanParams {
  const out: CleanParams = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (PII_PARAM_NAMES.has(key.toLowerCase())) continue
    if (key === 'items' && Array.isArray(value)) {
      out.items = value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .slice(0, 50)
        .map((item) => {
          const clean: Record<string, Primitive> = {}
          for (const [k, v] of Object.entries(sanitizeParams(item))) if (!Array.isArray(v)) clean[k] = v
          return clean
        })
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value
    } else if (typeof value === 'boolean') {
      out[key] = value
    } else if (typeof value === 'string') {
      if (key === 'page_location' || key === 'page_referrer') out[key] = sanitizeUrl(value).location
      // our own IDs (UUIDs, order references, slugs): kept as they are, unless one is an email
      else if (/(^|_)id$/.test(key)) out[key] = HAS_EMAIL.test(value) ? '(email)' : value.trim().slice(0, 100)
      else out[key] = scrubText(value, 100)
    }
  }
  return out
}
