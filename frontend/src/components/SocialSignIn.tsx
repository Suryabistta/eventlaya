import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { ApiError } from '@/services/api'
import { SOCIAL_ERRORS, loadFacebook, loadGoogle, socialApi, type SocialLoginResponse } from '@/lib/social'
import { cn } from '@/lib/utils'
import { LEGAL_PATHS } from '@/lib/legal'
import { LegalLink } from './LegalFooter'

interface Props {
  /** "Keep me signed in": sent as `remember` so the server picks the session length. */
  remember: boolean
  onSuccess: (res: SocialLoginResponse) => void
  onError: (message: string) => void
  /** Text for the buttons: "Continue with …" on both pages, Google's own wording differs slightly. */
  mode: 'signin' | 'signup'
  className?: string
}

const errorText = (e: unknown) => {
  if (e instanceof ApiError && e.code && SOCIAL_ERRORS[e.code]) return SOCIAL_ERRORS[e.code]
  return e instanceof Error ? e.message : 'Sign-in failed. Try again.'
}

/**
 * Google and Facebook buttons for the providers the server has configured
 * (GET /api/auth/social/config/). Renders nothing when none are, or while the config loads.
 */
export const SocialSignIn: React.FC<Props> = ({ remember, onSuccess, onError, mode, className }) => {
  const { data: config } = useQuery({
    queryKey: ['social-config'],
    queryFn: socialApi.config,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const google = config?.google.enabled && config.google.client_ids[0] ? config.google.client_ids[0] : null
  const facebook = config?.facebook.enabled && config.facebook.app_id ? config.facebook.app_id : null
  if (!google && !facebook) return null

  return (
    <div className={className}>
      <div className="space-y-2.5">
        {google && <GoogleButton clientId={google} remember={remember} mode={mode} onSuccess={onSuccess} onError={onError} />}
        {facebook && <FacebookButton appId={facebook} remember={remember} onSuccess={onSuccess} onError={onError} />}
      </div>
      {/* The server records this consent on the first Google/Facebook sign-in (terms_accepted_at). */}
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-500">
        By continuing with {google && facebook ? 'Google or Facebook' : google ? 'Google' : 'Facebook'}, you agree to the{' '}
        <LegalLink path={LEGAL_PATHS.terms} newTab className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900">
          Terms of service
        </LegalLink>{' '}
        and{' '}
        <LegalLink path={LEGAL_PATHS.privacy} newTab className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900">
          Privacy policy
        </LegalLink>
        .
      </p>
      <div className="my-6 flex items-center gap-3 text-xs font-medium text-ink-400" aria-hidden>
        <span className="h-px flex-1 bg-ink-200" />
        or with your email
        <span className="h-px flex-1 bg-ink-200" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const GoogleButton: React.FC<{ clientId: string; remember: boolean; mode: Props['mode']; onSuccess: Props['onSuccess']; onError: Props['onError'] }> = ({
  clientId,
  remember,
  mode,
  onSuccess,
  onError,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'busy' | 'failed'>('loading')
  // The GIS callback is registered once; keep the latest props in a ref.
  const latest = useRef({ remember, onSuccess, onError })
  latest.current = { remember, onSuccess, onError }

  useEffect(() => {
    let cancelled = false
    loadGoogle()
      .then((gis) => {
        if (cancelled || !ref.current) return
        gis.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
          callback: async ({ credential }) => {
            if (!credential) return
            setState('busy')
            try {
              latest.current.onSuccess(await socialApi.google(credential, latest.current.remember))
            } catch (e) {
              latest.current.onError(errorText(e))
            } finally {
              setState('ready')
            }
          },
        })
        gis.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: mode === 'signup' ? 'signup_with' : 'continue_with',
          logo_alignment: 'center',
          width: Math.min(400, ref.current.offsetWidth || 400),
        })
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [clientId, mode])

  if (state === 'failed') return null
  return (
    <div className="relative">
      <div ref={ref} className={cn('flex min-h-[44px] justify-center', state === 'busy' && 'pointer-events-none opacity-60')} />
      {(state === 'loading' || state === 'busy') && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-ink-200 bg-white text-sm text-ink-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          {state === 'busy' ? 'Signing you in…' : 'Loading Google…'}
        </div>
      )}
    </div>
  )
}

const FacebookMark: React.FC = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <path
      fill="#1877F2"
      d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"
    />
  </svg>
)

const FacebookButton: React.FC<{ appId: string; remember: boolean; onSuccess: Props['onSuccess']; onError: Props['onError'] }> = ({ appId, remember, onSuccess, onError }) => {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Load the SDK up front so FB.login runs inside the click (popup blockers allow it then).
  useEffect(() => {
    loadFacebook(appId).catch(() => setFailed(true))
  }, [appId])

  const click = () => {
    const FB = window.FB
    if (!FB) {
      onError('Facebook is still loading. Try again in a second.')
      return
    }
    FB.login(
      async (r) => {
        const token = r.authResponse?.accessToken
        if (!token) return // closed the popup
        setBusy(true)
        try {
          onSuccess(await socialApi.facebook(token, remember))
        } catch (e) {
          onError(errorText(e))
        } finally {
          setBusy(false)
        }
      },
      { scope: 'email' },
    )
  }

  if (failed) return null
  return (
    <button
      type="button"
      onClick={click}
      disabled={busy}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-ink-200 bg-white text-sm font-semibold text-ink-800 shadow-2xs transition-colors hover:border-ink-300 hover:bg-ink-50 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FacebookMark />}
      {busy ? 'Signing you in…' : 'Continue with Facebook'}
    </button>
  )
}
