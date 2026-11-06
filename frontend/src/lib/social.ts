import { request, type AuthUser } from '@/services/api'

/** GET /api/auth/social/config/: which providers the server can verify. */
export interface SocialConfig {
  enabled: ('google' | 'facebook')[]
  google: { enabled: boolean; client_ids: string[] }
  facebook: { enabled: boolean; app_id: string | null }
}

export interface SocialLoginResponse {
  access: string
  refresh: string
  user: AuthUser
  created: boolean
  provider: 'google' | 'facebook'
  linked_tickets: number
}

export const socialApi = {
  config: () => request<SocialConfig>('/auth/social/config/'),
  google: (id_token: string, remember: boolean) =>
    request<SocialLoginResponse>('/auth/social/google/', { method: 'POST', body: JSON.stringify({ id_token, remember }) }),
  facebook: (access_token: string, remember: boolean) =>
    request<SocialLoginResponse>('/auth/social/facebook/', { method: 'POST', body: JSON.stringify({ access_token, remember }) }),
}

/** Friendlier copy for the error codes the social endpoints return; falls back to the server message. */
export const SOCIAL_ERRORS: Record<string, string> = {
  email_required: 'We need your email address to sign you in. Allow email access when asked, or sign up with your email instead.',
  email_not_verified: 'That account’s email address isn’t verified yet. Verify it with the provider, or sign in with your email.',
  password_login_required: 'This account must sign in with its email and password.',
  provider_not_configured: 'This sign-in option isn’t available right now. Use your email and password.',
  provider_unavailable: 'We couldn’t reach the sign-in provider. Try again in a moment.',
  account_disabled: 'This account has been deactivated. Contact support@eventlaya.com.',
}

/* ------------------------------------------------------------ SDK loading */

const scripts = new Map<string, Promise<void>>()

/** Injects a third-party script once and resolves when it has loaded. */
export function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  const cached = scripts.get(src)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.defer = true
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    el.onload = () => resolve()
    el.onerror = () => {
      scripts.delete(src)
      el.remove()
      reject(new Error('Couldn’t load the sign-in button. Check your connection or ad blocker.'))
    }
    document.head.appendChild(el)
  })
  scripts.set(src, p)
  return p
}

/* Minimal typings for the two SDKs (only what we call). */
interface GoogleId {
  initialize: (opts: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
}
interface FacebookSdk {
  init: (opts: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }) => void
  login: (cb: (r: { authResponse?: { accessToken: string } | null; status?: string }) => void, opts: { scope: string }) => void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

export async function loadGoogle(): Promise<GoogleId> {
  await loadScript('https://accounts.google.com/gsi/client')
  if (!window.google?.accounts?.id) throw new Error('Google sign-in didn’t load. Try again.')
  return window.google.accounts.id
}

let fbReady: Promise<FacebookSdk> | null = null
export function loadFacebook(appId: string): Promise<FacebookSdk> {
  fbReady ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version: 'v19.0', cookie: false, xfbml: false })
      resolve(window.FB!)
    }
    loadScript('https://connect.facebook.net/en_US/sdk.js', { crossorigin: 'anonymous' }).catch((e) => {
      fbReady = null
      reject(e)
    })
  })
  return fbReady
}

/** Opens the Facebook login popup; resolves with the user access token, or null if they cancelled. */
export async function facebookAccessToken(appId: string): Promise<string | null> {
  const FB = await loadFacebook(appId)
  return new Promise((resolve) => FB.login((r) => resolve(r.authResponse?.accessToken ?? null), { scope: 'email' }))
}
