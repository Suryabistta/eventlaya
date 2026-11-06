import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { track } from '@/lib/analytics'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, CalendarDays, Check, ImagePlus, Inbox, QrCode, ShieldCheck, Star, Store, Ticket } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api, request } from '@/services/api'
import { Badge, Button, Input, Select, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { AuthShell, EventToolsAside, FeatureList, PasswordInput, PasswordStrength } from './shared'
import { SocialSignIn } from '@/components/SocialSignIn'
import { LegalLink } from '@/components/LegalFooter'
import { LEGAL_PATHS } from '@/lib/legal'
import type { SocialLoginResponse } from '@/lib/social'

/* ------------------------------------------------------------------ */
/* Model                                                                */

type AccountType = 'attendee' | 'organizer' | 'vendor'
type BusinessType = 'venue' | 'sound_stage' | 'photo_video' | 'decoration' | 'catering' | 'other'

interface SignupData {
  account_type: AccountType
  organization_name: string
  first_name: string
  last_name: string
  business_type: BusinessType | ''
  city: string
  city_other: string
  phone: string
  email: string
  password: string
  confirm: string
  terms: boolean
}
type Field = keyof SignupData
type Errors = Partial<Record<Field, string>>

const STEPS = [
  { title: 'Account type', heading: 'How will you use Eventlaya?' },
  { title: 'Details', heading: 'Tell us about your organization' },
  { title: 'Sign-in details', heading: 'Set up your sign-in' },
  { title: 'Review', heading: 'Check your details' },
] as const
const LAST = STEPS.length

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'venue', label: 'Venue or party palace' },
  { value: 'sound_stage', label: 'Sound, lights and stage' },
  { value: 'photo_video', label: 'Photo and video' },
  { value: 'decoration', label: 'Decoration' },
  { value: 'catering', label: 'Catering' },
  { value: 'other', label: 'Something else' },
]
const CITIES = ['Dharan', 'Itahari', 'Biratnagar', 'Kathmandu']
const OTHER_CITY = '__other'

/** Which step owns each field, so server errors can send the user back to it. */
const FIELD_STEP: Partial<Record<string, number>> = {
  account_type: 1,
  organization_name: 2,
  first_name: 2,
  last_name: 2,
  business_type: 2,
  city: 2,
  phone: 2,
  email: 3,
  password: 3,
  username: 3,
  terms: 3,
}

const isVendorData = (d: SignupData) => d.account_type === 'vendor'
const isAttendeeData = (d: SignupData) => d.account_type === 'attendee'
const cityValue = (d: SignupData) => (d.city === OTHER_CITY ? d.city_other.trim() : d.city)

function validateStep(step: number, d: SignupData): Errors {
  const e: Errors = {}
  const vendor = isVendorData(d)
  if (step === 2) {
    if (isAttendeeData(d)) {
      if (!d.first_name.trim()) e.first_name = 'Enter your first name.'
    } else if (!d.organization_name.trim()) e.organization_name = vendor ? 'Enter your business name.' : 'Enter your club or organization name.'
    if (vendor && !d.business_type) e.business_type = 'Choose what your business offers.'
    if (vendor && !d.city) e.city = 'Choose the city you work from.'
    if (d.city === OTHER_CITY && !d.city_other.trim()) e.city_other = 'Enter your city.'
    if (vendor && !d.phone.trim()) e.phone = 'Add a phone number so organizers can reach you.'
    else if (d.phone.trim() && !/^[+\d][\d\s-]{6,}$/.test(d.phone.trim())) e.phone = 'Enter a phone number like 98XXXXXXXX.'
  }
  if (step === 3) {
    if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) e.email = 'Enter a valid email address.'
    if (d.password.length < 8) e.password = 'Use at least 8 characters.'
    if (!d.confirm) e.confirm = 'Type your password again.'
    else if (d.confirm !== d.password) e.confirm = 'The passwords don’t match.'
    if (!d.terms) e.terms = 'Agree to the Terms of service and Privacy policy to create your account.'
  }
  return e
}

/** First step (1-based) with a problem, or LAST if everything before review is valid. */
const furthestValidStep = (d: SignupData) => {
  for (let s = 2; s < LAST; s++) if (Object.keys(validateStep(s, d)).length) return s
  return LAST
}

/* ------------------------------------------------------------------ */
/* Stepper                                                              */

const Stepper: React.FC<{ step: number; onJump: (s: number) => void; maxStep: number }> = ({ step, onJump, maxStep }) => (
  <nav aria-label="Sign-up progress">
    {/* Phones: compact progress */}
    <div className="sm:hidden">
      <div className="flex items-baseline justify-between text-sm">
        <p className="font-semibold text-ink-900">{STEPS[step - 1].title}</p>
        <p className="text-ink-500">
          Step {step} of {LAST}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={1} aria-valuemax={LAST} aria-valuenow={step} aria-label={`Step ${step} of ${LAST}`}>
        <div className="h-full rounded-full bg-brand-600 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${(step / LAST) * 100}%` }} />
      </div>
    </div>

    {/* sm+: numbered steps joined by a line */}
    <ol className="hidden sm:flex">
      {STEPS.map((s, i) => {
        const n = i + 1
        const done = n < step
        const current = n === step
        const reachable = n <= maxStep && !current
        const circle = (
          <span
            className={cn(
              'relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular transition-colors',
              done && 'bg-brand-600 text-white',
              current && 'bg-white text-brand-700 ring-2 ring-brand-600 ring-offset-2',
              !done && !current && 'bg-ink-200 text-ink-600',
            )}
          >
            {done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : n}
          </span>
        )
        const label = (
          <span className={cn('mt-2 text-xs font-medium', current ? 'text-ink-900' : done ? 'text-ink-700' : 'text-ink-500')}>
            {s.title}
            <span className="sr-only">{done ? ' (done)' : current ? ' (current step)' : ''}</span>
          </span>
        )
        return (
          <li key={s.title} className="relative flex flex-1 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
            {i > 0 && (
              <span aria-hidden className={cn('absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2', n <= step ? 'bg-brand-600' : 'bg-ink-200')} />
            )}
            {reachable ? (
              <button type="button" onClick={() => onJump(n)} className="flex flex-col items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {circle}
                {label}
              </button>
            ) : (
              <span className="flex flex-col items-center">
                {circle}
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  </nav>
)

/* ------------------------------------------------------------------ */
/* Steps                                                                */

const ACCOUNT_TYPES: { value: AccountType; title: string; text: string; icon: React.ElementType; hint?: string }[] = [
  {
    value: 'attendee',
    title: 'I want to attend events',
    text: 'Keep all your passes in one place, vote in live polls and review events you went to.',
    icon: Ticket,
  },
  {
    value: 'organizer',
    title: 'I organise events',
    text: 'For event companies, clubs and colleges: registration, QR passes, gate scanning and live voting.',
    icon: CalendarDays,
    hint: 'Also rent out venues or services? You can request marketplace access later.',
  },
  {
    value: 'vendor',
    title: 'I list my business on the marketplace',
    text: 'For venues, sound and stage, decoration, photographers and caterers who want event bookings.',
    icon: Store,
  },
]

const AccountTypeStep: React.FC<{ value: AccountType; onChange: (v: AccountType) => void }> = ({ value, onChange }) => (
  <fieldset>
    <legend className="sr-only">Account type</legend>
    <div className="grid gap-3">
      {ACCOUNT_TYPES.map((t) => {
        const selected = value === t.value
        return (
          <label
            key={t.value}
            className={cn(
              'flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 sm:p-5',
              selected ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
            )}
          >
            <input type="radio" name="account_type" value={t.value} checked={selected} onChange={() => onChange(t.value)} className="sr-only" />
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', selected ? 'bg-white text-brand-600' : 'bg-ink-100 text-ink-600')}>
              <t.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink-900">{t.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-600">{t.text}</span>
              {t.hint && <span className="mt-2 block text-xs text-ink-500">{t.hint}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-white',
              )}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
          </label>
        )
      })}
    </div>
  </fieldset>
)

type StepProps = { data: SignupData; errors: Errors; set: <K extends Field>(k: K, v: SignupData[K]) => void }

const PersonStep: React.FC<StepProps> = ({ data, errors, set }) => (
  <div className="space-y-5">
    <div className="grid gap-5 sm:grid-cols-2">
      <Input name="first_name" label="First name" required autoComplete="given-name" className="h-11" value={data.first_name} error={errors.first_name} onChange={(e) => set('first_name', e.target.value)} />
      <Input name="last_name" label="Last name" hint="Optional" autoComplete="family-name" className="h-11" value={data.last_name} error={errors.last_name} onChange={(e) => set('last_name', e.target.value)} />
    </div>
    <div className="grid gap-5 sm:grid-cols-2">
      <Select name="city" label="City" hint="Optional" className="h-11" value={data.city} error={errors.city} onChange={(e) => set('city', e.target.value)}>
        <option value="">Not set</option>
        {CITIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
        <option value={OTHER_CITY}>Other…</option>
      </Select>
      <Input name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" hint="Optional, fills in event forms for you" className="h-11" value={data.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
    </div>
    {data.city === OTHER_CITY && (
      <Input name="city_other" label="City name" required autoComplete="address-level2" className="h-11" value={data.city_other} error={errors.city_other} onChange={(e) => set('city_other', e.target.value)} />
    )}
  </div>
)

const OrganizationStep: React.FC<StepProps> = ({ data, errors, set }) => {
  const vendor = isVendorData(data)
  if (isAttendeeData(data)) return <PersonStep data={data} errors={errors} set={set} />
  return (
    <div className="space-y-5">
      <Input
        name="organization_name"
        label={vendor ? 'Business name' : 'Club or organization'}
        placeholder={vendor ? 'e.g. Koshi Floral and Stage Decors' : 'e.g. Purwanchal Campus IT Club'}
        autoComplete="organization"
        required
        className="h-11"
        value={data.organization_name}
        error={errors.organization_name}
        onChange={(e) => set('organization_name', e.target.value)}
      />
      {vendor && (
        <Select name="business_type" label="What do you offer?" required className="h-11" value={data.business_type} error={errors.business_type} onChange={(e) => set('business_type', e.target.value as BusinessType)}>
          <option value="" disabled>
            Choose one
          </option>
          {BUSINESS_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Select name="city" label="City" required={vendor} hint={vendor ? undefined : 'Optional'} className="h-11" value={data.city} error={errors.city} onChange={(e) => set('city', e.target.value)}>
          <option value="">{vendor ? 'Choose a city' : 'Not set'}</option>
          {CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
          <option value={OTHER_CITY}>Other…</option>
        </Select>
        <Input
          name="phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98XXXXXXXX"
          required={vendor}
          hint={vendor ? 'Shown to organizers who contact you' : 'Optional'}
          className="h-11"
          value={data.phone}
          error={errors.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
      </div>
      {data.city === OTHER_CITY && (
        <Input name="city_other" label="City name" required autoComplete="address-level2" className="h-11" value={data.city_other} error={errors.city_other} onChange={(e) => set('city_other', e.target.value)} />
      )}
    </div>
  )
}

const CredentialsStep: React.FC<StepProps & { checkingEmail: boolean }> = ({ data, errors, set, checkingEmail }) => (
  <div className="space-y-5">
    <Input
      name="email"
      label={isAttendeeData(data) ? 'Email' : 'Work email'}
      type="email"
      inputMode="email"
      autoComplete="email"
      required
      className="h-11"
      value={data.email}
      error={errors.email}
      hint={checkingEmail ? 'Checking this email…' : 'You’ll sign in with this'}
      onChange={(e) => set('email', e.target.value)}
    />
    <div>
      <PasswordInput name="password" label="Password" autoComplete="new-password" required value={data.password} error={errors.password} onChange={(e) => set('password', e.target.value)} />
      <PasswordStrength password={data.password} />
    </div>
    <PasswordInput name="confirm" label="Confirm password" autoComplete="new-password" required value={data.confirm} error={errors.confirm} onChange={(e) => set('confirm', e.target.value)} />
    <div>
      <label className="flex items-start gap-2.5 text-sm text-ink-700">
        <input
          type="checkbox"
          name="terms"
          checked={data.terms}
          onChange={(e) => set('terms', e.target.checked)}
          aria-invalid={errors.terms ? true : undefined}
          aria-describedby={errors.terms ? 'terms-error' : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-600"
        />
        <span>
          I agree to the{' '}
          <LegalLink path={LEGAL_PATHS.terms} newTab className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Terms of service
          </LegalLink>{' '}
          and{' '}
          <LegalLink path={LEGAL_PATHS.privacy} newTab className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Privacy policy
          </LegalLink>
        </span>
      </label>
      {errors.terms && (
        <p id="terms-error" className="mt-1.5 text-xs font-medium text-red-600">
          {errors.terms}
        </p>
      )}
    </div>
  </div>
)

const ReviewGroup: React.FC<{ title: string; onEdit: () => void; rows: [string, React.ReactNode][] }> = ({ title, onEdit, rows }) => (
  <section className="rounded-2xl border border-ink-200 bg-white">
    <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <button type="button" onClick={onEdit} className="rounded-md text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        Edit<span className="sr-only"> {title.toLowerCase()}</span>
      </button>
    </div>
    <dl className="divide-y divide-ink-100">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4 px-4 py-2.5 text-sm">
          <dt className="w-28 shrink-0 text-ink-500">{k}</dt>
          <dd className="min-w-0 font-medium text-ink-900 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  </section>
)

const ReviewStep: React.FC<{ data: SignupData; goTo: (s: number) => void }> = ({ data, goTo }) => {
  const vendor = isVendorData(data)
  const attendee = isAttendeeData(data)
  return (
    <div className="space-y-3">
      <ReviewGroup
        title="Account type"
        onEdit={() => goTo(1)}
        rows={[['Using it to', attendee ? 'Attend events' : vendor ? 'List my business on the marketplace' : 'Organise events']]}
      />
      {attendee ? (
        <ReviewGroup
          title="About you"
          onEdit={() => goTo(2)}
          rows={[
            ['Name', [data.first_name.trim(), data.last_name.trim()].filter(Boolean).join(' ')],
            ['City', cityValue(data) || <span className="font-normal text-ink-500">Not set</span>],
            ['Phone', data.phone.trim() || <span className="font-normal text-ink-500">Not set</span>],
          ]}
        />
      ) : (
      <ReviewGroup
        title={vendor ? 'Business' : 'Organization'}
        onEdit={() => goTo(2)}
        rows={[
          ['Name', data.organization_name.trim()],
          ...(vendor ? ([['Offers', BUSINESS_TYPES.find((t) => t.value === data.business_type)?.label ?? '']] as [string, string][]) : []),
          ['City', cityValue(data) || <span className="font-normal text-ink-500">Not set</span>],
          ['Phone', data.phone.trim() || <span className="font-normal text-ink-500">Not set</span>],
        ]}
      />
      )}
      <ReviewGroup
        title="Sign-in details"
        onEdit={() => goTo(3)}
        rows={[
          ['Email', data.email.trim()],
          ['Password', <span key="pw" className="tracking-widest">{'•'.repeat(Math.min(data.password.length, 12))}</span>],
        ]}
      />
      <p className="pt-1 text-xs leading-relaxed text-ink-500">
        {attendee
          ? 'We’ll email you a 6-digit code to confirm your address. Passes you registered with this email are then added to your account.'
          : vendor
            ? 'Listing is free. Your venues and service profiles go live after a quick review.'
            : 'Free for events up to 150 attendees. No card needed.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Right-hand panel for vendors                                        */

const MarketplaceAside: React.FC = () => (
  <>
    <h2 className="font-display text-[34px] font-bold leading-[1.1] text-ink-900">Get booked for events in Eastern Nepal.</h2>
    <FeatureList
      items={[
        { icon: Building2, text: 'List halls, lawns and services with prices' },
        { icon: ImagePlus, text: 'Upload photos of your venue and past work' },
        { icon: Inbox, text: 'Booking inquiries land in one inbox' },
        { icon: ShieldCheck, text: 'Reviewed listings organizers can trust' },
      ]}
    />
    <div className="mt-10 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm" aria-hidden>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-900">Inquiries</p>
        <Badge tone="brand" dot>
          2 new
        </Badge>
      </div>
      <ul className="mt-3 divide-y divide-ink-100">
        {[
          { who: 'Dharan Rotary Club', what: 'Charity gala, 500 guests', tag: 'New', tone: 'brand' as const },
          { who: 'Sunita Limbu', what: 'Engagement, 250 guests', tag: 'Contacted', tone: 'warning' as const },
          { who: 'Purwanchal IT Club', what: 'Tech fest stage and sound', tag: 'Booked', tone: 'success' as const },
        ].map((r) => (
          <li key={r.who} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-900">{r.who}</p>
              <p className="truncate text-xs text-ink-500">{r.what}</p>
            </div>
            <Badge tone={r.tone} dot>
              {r.tag}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  </>
)

const AttendeeAside: React.FC = () => (
  <>
    <h2 className="font-display text-[34px] font-bold leading-[1.1] text-ink-900">Every pass, in one place.</h2>
    <FeatureList
      items={[
        { icon: QrCode, text: 'Passes from every event you register for' },
        { icon: Ticket, text: 'Register in seconds with your details filled in' },
        { icon: Star, text: 'Vote in live polls and review events you went to' },
      ]}
    />
  </>
)

/* ------------------------------------------------------------------ */
/* Page                                                                 */

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const SignupPage: React.FC = () => {
  const { login, status, startSession } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [data, setData] = useState<SignupData>(() => ({
    account_type: (['vendor', 'attendee'] as const).find((t) => t === params.get('type')) ?? 'organizer',
    organization_name: '',
    first_name: '',
    last_name: '',
    business_type: '',
    city: '',
    city_other: '',
    phone: '',
    email: '',
    password: '',
    confirm: '',
    terms: false,
  }))
  const [errors, setErrors] = useState<Errors>({})
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusField = useRef<Field | null>(null)
  const firstRender = useRef(true)

  const requested = Math.min(Math.max(Number(params.get('step')) || 1, 1), LAST)
  const maxStep = furthestValidStep(data)
  const step = Math.min(requested, maxStep)
  const vendor = isVendorData(data)
  const attendee = isAttendeeData(data)

  // Never show a step past the first invalid one (e.g. a pasted ?step=4 URL).
  useEffect(() => {
    if (requested !== step) {
      const next = new URLSearchParams(params)
      next.set('step', String(step))
      setParams(next, { replace: true })
    }
  }, [requested, step, params, setParams])

  // Step transitions: short slide/fade, then focus the heading (or the field that needs fixing).
  const [entered, setEntered] = useState(true)
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!prefersReducedMotion()) {
      setEntered(false)
      requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    }
    const field = focusField.current
    focusField.current = null
    requestAnimationFrame(() => {
      const el = field ? formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`) : null
      ;(el ?? headingRef.current)?.focus()
    })
  }, [step])

  if (status === 'authenticated' && !submitting) return <Navigate to="/app" replace />

  const set = <K extends Field>(k: K, v: SignupData[K]) => {
    setData((d) => ({ ...d, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const goTo = (s: number, field?: Field) => {
    focusField.current = field ?? null
    const next = new URLSearchParams(params)
    next.set('step', String(s))
    setParams(next)
  }

  const showErrors = (e: Errors) => {
    setErrors(e)
    const fields = Object.keys(e) as Field[]
    const first = fields[0]
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus())
    toast.error(fields.length === 1 ? 'Check the highlighted field' : `Check the ${fields.length} highlighted fields`, e[first])
  }

  const emailTaken = async (email: string) => {
    setCheckingEmail(true)
    try {
      const res = await request<{ available: boolean }>(`/auth/email-available/?email=${encodeURIComponent(email)}`)
      return !res.available
    } catch {
      return false // The server checks again on create; don't block on a failed lookup.
    } finally {
      setCheckingEmail(false)
    }
  }

  const create = async () => {
    setSubmitting(true)
    try {
      await api.register({
        account_type: data.account_type,
        ...(attendee
          ? { first_name: data.first_name.trim(), last_name: data.last_name.trim() || undefined }
          : { organization_name: data.organization_name.trim() }),
        email: data.email.trim(),
        password: data.password,
        phone: data.phone.trim() || undefined,
        ...(vendor ? { business_type: data.business_type || undefined } : {}),
        city: cityValue(data) || undefined,
        terms: data.terms,
      })
      await login(data.email.trim(), data.password)
      track('sign_up', { method: 'email', account_type: data.account_type })
      if (vendor) {
        toast.success('Account created', 'Next, add your first listing.')
        navigate(data.business_type === 'venue' ? '/app/listings/venues/new' : '/app/listings/vendor/new', { replace: true })
      } else {
        // Confirm the email first (the server already sent the code), then carry on.
        toast.success('Account created', `We sent a 6-digit code to ${data.email.trim()}.`)
        navigate(`/verify-email?sent=1&next=${encodeURIComponent(attendee ? '/app/my/tickets' : '/app/events/new')}`, { replace: true })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again in a moment.'
      // request() formats DRF field errors as "field: message".
      const m = msg.match(/^(\w+): (.*)$/)
      const field = m?.[1]
      const target = field ? FIELD_STEP[field] : undefined
      if (m && target) {
        const key = (field === 'username' ? 'email' : field) as Field
        setErrors({ [key]: m[2] })
        goTo(target, key)
        toast.error('Couldn’t create your account', m[2])
      } else {
        toast.error('Couldn’t create your account', msg)
      }
      setSubmitting(false)
    }
  }

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting || checkingEmail) return
    if (step === LAST) return create()
    const stepErrors = validateStep(step, data)
    if (Object.keys(stepErrors).length) return showErrors(stepErrors)
    if (step === 3 && (await emailTaken(data.email.trim()))) {
      return showErrors({ email: 'An account with this email already exists. Sign in instead, or use another email.' })
    }
    setErrors({})
    goTo(step + 1)
  }

  const back = () => {
    setErrors({})
    goTo(step - 1)
  }

  const actions = (
    <div className="flex gap-3">
      {step > 1 && (
        <Button variant="secondary" size="lg" onClick={back} icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="sm:w-auto">
          Back
        </Button>
      )}
      <Button type="submit" form="signup-form" size="lg" className="flex-1" loading={submitting || checkingEmail}>
        {step === LAST ? 'Create account' : 'Continue'}
      </Button>
    </div>
  )

  return (
    <AuthShell
      wide
      stickyFooter
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
      aside={vendor ? <MarketplaceAside /> : attendee ? <AttendeeAside /> : <EventToolsAside />}
    >
      {step === 1 && attendee && (
        <SocialSignIn
          mode="signup"
          remember
          onSuccess={(res: SocialLoginResponse) => {
            startSession(res, true)
            track(res.created ? 'sign_up' : 'login', { method: res.provider, account_type: 'attendee' })
            toast.success(res.created ? 'Account created' : 'Welcome back', res.linked_tickets ? `${res.linked_tickets} pass${res.linked_tickets === 1 ? '' : 'es'} linked to your account.` : undefined)
            navigate('/app', { replace: true })
          }}
          onError={(msg) => toast.error('Couldn’t sign you up', msg)}
        />
      )}
      <Stepper step={step} maxStep={maxStep} onJump={(s) => goTo(s)} />

      <form id="signup-form" ref={formRef} onSubmit={onContinue} noValidate className="mt-8">
        <div
          className={cn(
            'motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out',
            entered ? 'translate-x-0 opacity-100' : 'translate-x-3 opacity-0',
          )}
        >
          <h2 ref={headingRef} tabIndex={-1} className="mb-5 text-lg font-bold text-ink-900 focus:outline-none">
            {step === 2 && vendor ? 'Tell us about your business' : step === 2 && attendee ? 'Tell us about yourself' : STEPS[step - 1].heading}
          </h2>
          {step === 1 && <AccountTypeStep value={data.account_type} onChange={(v) => set('account_type', v)} />}
          {step === 2 && <OrganizationStep data={data} errors={errors} set={set} />}
          {step === 3 && <CredentialsStep data={data} errors={errors} set={set} checkingEmail={checkingEmail} />}
          {step === 4 && <ReviewStep data={data} goTo={(s) => goTo(s)} />}
        </div>

        <div className="mt-8 hidden sm:block">{actions}</div>
      </form>

      {/* Phones: sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
        {actions}
      </div>
    </AuthShell>
  )
}

export default SignupPage
