import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { track, trackTicketPurchase } from '@/lib/analytics'
import { useTenant } from '@/lib/tenant'
import { LegalLink } from '@/components/LegalFooter'
import { LEGAL_PATHS } from '@/lib/legal'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Radio,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  MapPin,
  Minus,
  Plus,
  Printer,
  Share2,
  Tag,
  Ticket as TicketIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { api, type DynamicForm, type FormField, type RegisterItem, type Ticket } from '@/services/api'
import { TicketPass, PrintablePasses } from '@/components/TicketPassModal'
import { DownloadAllPassesButton, DownloadPassButton } from '@/components/DownloadPassButton'
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import {
  downloadIcs,
  eventPageApi,
  eventWhen,
  getStoredPasses,
  hasPaidTickets,
  priceLabel,
  registrationState,
  shareOrCopy,
  sortPasses,
  spotsInfo,
  storePasses,
  type PublicEvent,
} from '@/lib/event-page'
import { availabilityText, fmtShortDate, money, priceText, ticketsApi, type PromoCheck, type PromoTicketType, type PublicTicketType } from '@/lib/tickets'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { personName } from '@/lib/account'
import { goToCheckout, paymentNote, type PublicIntent } from '@/lib/payments'
import { PaymentChoice, PaymentReturn, type TicketOrderResult } from '@/components/payments'

/* ---------- fields ---------- */

type Builtin = 'name' | 'email' | 'phone'

/** Forms often repeat the name/email/phone we already ask for. Detect those so they're asked once. */
function builtinOf(f: FormField): Builtin | null {
  const label = f.label.trim().toLowerCase()
  if (f.field_type === 'email' || /e-?mail/.test(label)) return 'email'
  if (f.field_type === 'phone' || /phone|mobile/.test(label)) return 'phone'
  if (/full name|^name$|^your name$/.test(label)) return 'name'
  return null
}

const keyOf = (f: FormField) => f.id || f.label
const isConsent = (f: FormField) => f.field_type === 'checkbox' && !f.options?.length && f.required
const invalidCls = 'aria-[invalid=true]:border-red-400'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Answers = Record<string, unknown>
type Errors = Record<string, string>
type StepId = 'tickets' | 'details' | 'questions' | 'review' | 'pass'
const STEP_LABEL: Record<StepId, string> = { tickets: 'Tickets', details: 'Your details', questions: 'Event questions', review: 'Review', pass: 'Your pass' }

interface Draft {
  name: string
  email: string
  phone: string
  answers: Answers
  maxReached: number
  /** How many of each ticket type, by type id */
  quantities: Record<string, number>
  /** Names for tickets 2, 3, … in order (blank = "<Buyer> · Guest N") */
  guestNames: string[]
  /** Promo code the attendee applied (re-checked on reload) */
  promoCode: string
  /** Already registered and getting more tickets on top */
  additional: boolean
  /** 'venue' or an online provider id ('khalti', 'esewa') */
  payWith: string
}
const emptyDraft: Draft = { name: '', email: '', phone: '', answers: {}, maxReached: 0, quantities: {}, guestNames: [], promoCode: '', additional: false, payWith: '' }

type TypeOption = PublicTicketType & Partial<Pick<PromoTicketType, 'discounted_price' | 'promo_applies' | 'unlocked'>>
/** Events without ticket types sell free, untyped passes. */
const FREE_ID = '__free__'
const FREE_OPTION: TypeOption = { id: FREE_ID, name: 'Entry pass', description: '', price: '0', remaining: null, sales_start: null, sales_end: null, availability: 'on_sale', note: '' }

/** Price the attendee pays for a type, with the promo when it applies. */
const dueFor = (t: TypeOption) => (t.promo_applies && t.discounted_price !== undefined ? Number(t.discounted_price) : Number(t.price))
const draftKey = (slug: string) => `eventlaya:reg-draft-v2:${slug}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function loadDraft(slug: string): Draft {
  try {
    const raw = sessionStorage.getItem(draftKey(slug))
    return raw ? { ...emptyDraft, ...(JSON.parse(raw) as Partial<Draft>) } : emptyDraft
  } catch {
    return emptyDraft
  }
}
function saveDraft(slug: string, d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(draftKey(slug), JSON.stringify(d))
    else sessionStorage.removeItem(draftKey(slug))
  } catch {
    /* storage unavailable */
  }
}

/** Starting quantities: the ticket the event page linked to, else 1 when there's only one ticket to get. */
function startingQuantities(event: PublicEvent, wanted: string | null): Record<string, number> {
  const types = event.ticket_types ?? []
  if (!types.length) return { [FREE_ID]: 1 }
  const onSale = types.filter((t) => t.availability === 'on_sale')
  if (wanted && onSale.some((t) => t.id === wanted)) return { [wanted]: 1 }
  return onSale.length === 1 ? { [onSale[0].id]: 1 } : {}
}
const sumOf = (q: Record<string, number>) => Object.values(q).reduce((a, b) => a + (b || 0), 0)

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)
const answerText = (v: unknown) => (isEmpty(v) ? 'Not answered' : Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : String(v))

const isNotFound = (err: unknown) => err instanceof Error && /no event matches|not found|\(404\)/i.test(err.message)

/** One line of the order: a ticket type and how many. */
interface Line {
  type: TypeOption
  qty: number
}

interface Pricing {
  lines: Line[]
  count: number
  subtotal: number
  discount: number
  total: number
  /** The promo code that will be sent (only when it applies to a chosen ticket) */
  promoCode: string | null
  /** A code is applied but none of the chosen tickets get it */
  promoUnused: boolean
}

/* ---------- page ---------- */

export const EventRegisterPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>()
  const tenantHome = useTenant() ? 'See all events' : 'Go to Eventlaya home'
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['publicEvent', slug],
    queryFn: () => eventPageApi.publicDetail(slug!),
    enabled: Boolean(slug),
    retry: (count, err) => !isNotFound(err) && count < 1,
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[420px] rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    )
  }
  if (isError && !isNotFound(error)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <ErrorState message={`${(error as Error).message} Check your connection and try again.`} onRetry={() => void refetch()} />
      </div>
    )
  }
  if (!data?.event) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Card>
          <EmptyState
            icon={<AlertCircle className="h-6 w-6" aria-hidden />}
            title="We couldn't find this event"
            description="The link may be mistyped, or the organizer hasn't published the event yet."
            action={
              <ButtonLink to="/" variant="secondary">
                {tenantHome}
              </ButtonLink>
            }
          />
        </Card>
      </div>
    )
  }
  return <Registration key={slug} slug={slug!} event={data.event} form={data.form} />
}

/* ------------------------------------------------------------------ */

interface RegisteredInfo {
  number: string
  name: string
  email: string
  existing: boolean
}

interface Issued {
  tickets: Ticket[]
  existing: boolean
  orderReference?: string
  /** These were bought on top of earlier passes */
  additional?: boolean
}

const Registration: React.FC<{ slug: string; event: PublicEvent; form: DynamicForm | null }> = ({ slug, event, form }) => {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const when = eventWhen(event)
  const state = registrationState(event)

  const fields = useMemo(() => [...(form?.fields ?? [])].sort((a, b) => a.order - b.order), [form])
  const mapped = useMemo(() => fields.filter((f) => builtinOf(f)), [fields])
  const consents = useMemo(() => fields.filter((f) => !builtinOf(f) && isConsent(f)), [fields])
  const questions = useMemo(() => fields.filter((f) => !builtinOf(f) && !isConsent(f)), [fields])
  const mappedFor = (b: Builtin) => mapped.find((f) => builtinOf(f) === b)
  const phoneRequired = Boolean(mappedFor('phone')?.required)

  // Registration-only events (no pass): no ticket step, nothing to pay, and a confirmation at the end
  const formOnly = event.registration_mode === 'form' || event.registration_mode === 'apply'
  const applying = event.registration_mode === 'apply'
  // Free event with nothing to choose (no ticket types, or a single free one): no ticket step;
  // the group size is asked in Your details instead
  const eventTypes = event.ticket_types ?? []
  const simpleFreeId = formOnly || event.has_promo_codes
    ? null
    : !eventTypes.length
      ? FREE_ID
      : eventTypes.length === 1 && Number(eventTypes[0].price) === 0 && eventTypes[0].availability === 'on_sale'
        ? eventTypes[0].id
        : null
  const simpleFree = simpleFreeId !== null
  const steps: StepId[] = [...(formOnly || simpleFree ? [] : ['tickets' as const]), 'details', ...(questions.length ? ['questions' as const] : []), 'review', 'pass']
  const labels: Record<StepId, string> = applying ? { ...STEP_LABEL, questions: 'Your entry', pass: 'Done' } : formOnly ? { ...STEP_LABEL, pass: 'Done' } : STEP_LABEL
  const passIdx = steps.length - 1

  const [draft, setDraft] = useState<Draft>(() => {
    const d = loadDraft(slug)
    const wanted = params.get('ticket')
    if (sumOf(d.quantities) > 0 && !(wanted && !d.quantities[wanted])) return d
    return { ...d, quantities: startingQuantities(event, wanted) }
  })
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Signed in: fill in the account's details (never overwrite what was typed). The JWT goes with the
  // request, so a verified account gets the passes linked to it.
  useEffect(() => {
    if (!user) return
    setDraft((d) => ({
      ...d,
      name: d.name || (user.role === 'attendee' || user.first_name ? personName(user) : ''),
      email: d.email || user.email || '',
      phone: d.phone || user.phone || '',
    }))
  }, [user])

  /* ----- tickets and promo ----- */
  const [promo, setPromo] = useState<PromoCheck | null>(null)
  const [promoInput, setPromoInput] = useState(draft.promoCode)
  const [promoOpen, setPromoOpen] = useState(Boolean(draft.promoCode))
  const [promoError, setPromoError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const hasTypes = (event.ticket_types?.length ?? 0) > 0 || Boolean(promo?.ticket_types.length)
  const options: TypeOption[] = hasTypes ? (promo ? promo.ticket_types : (event.ticket_types ?? [])) : [FREE_OPTION]
  const buyable = options.filter((t) => t.availability === 'on_sale')
  const noTicketsLeft = buyable.length === 0

  // Most tickets this order can hold: the organizer's per-order limit, and the event's spots left
  const orderMax = Math.max(1, event.max_tickets_per_order ?? 10)
  // Hidden counts arrive blank (capacity 0, remaining null): then only the order limit applies
  const spotsLeft = spotsInfo(event).left
  const cap = Math.max(0, Math.min(orderMax, spotsLeft ?? Infinity))

  const pricing: Pricing = useMemo(() => {
    if (formOnly) return { lines: [], count: 1, subtotal: 0, discount: 0, total: 0, promoCode: null, promoUnused: false }
    const lines = buyable.map((type) => ({ type, qty: Math.max(0, draft.quantities[type.id] ?? 0) })).filter((l) => l.qty > 0)
    const count = lines.reduce((a, l) => a + l.qty, 0)
    const subtotal = lines.reduce((a, l) => a + l.qty * Number(l.type.price), 0)
    const total = lines.reduce((a, l) => a + l.qty * dueFor(l.type), 0)
    const uses = Boolean(promo && lines.some((l) => l.type.promo_applies || l.type.unlocked))
    return { lines, count, subtotal, discount: subtotal - total, total, promoCode: uses ? promo!.code : null, promoUnused: Boolean(promo && count > 0 && !uses) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, draft.quantities, promo])

  /** Highest quantity allowed for a type, given what else is in the order. */
  const maxFor = (t: TypeOption) => {
    const others = pricing.count - (draft.quantities[t.id] ?? 0)
    return Math.max(0, Math.min(t.remaining ?? Infinity, cap - others))
  }
  // No ticket step: always at least one person (an old saved draft may hold 0)
  useEffect(() => {
    if (simpleFreeId && !(draft.quantities[simpleFreeId] > 0)) setDraft((d) => ({ ...d, quantities: { [simpleFreeId]: 1 } }))
  }, [simpleFreeId, draft.quantities])
  const setQty = (id: string, qty: number) => {
    setDraft((d) => ({ ...d, quantities: { ...d.quantities, [id]: Math.max(0, qty) } }))
    if (errors.tickets) setErrors(({ tickets: _, ...r }) => r)
  }

  /* ----- payment: online (Khalti / eSewa) and/or at the venue ----- */
  const payOpts = event.payment_options
  const onlineProviders = payOpts?.online ? payOpts.providers : []
  const onlineOnlyNames = pricing.lines.filter((l) => l.type.online_only).map((l) => l.type.name)
  const venueAllowed = (payOpts ? payOpts.venue : true) && onlineOnlyNames.length === 0
  const venueBlockedReason = onlineOnlyNames.length ? `${onlineOnlyNames.join(', ')} tickets must be paid online.` : null
  const payChoices = [...onlineProviders.filter((p) => !(p.id === 'khalti' && pricing.total < 10)).map((p) => p.id as string), ...(venueAllowed ? ['venue'] : [])]
  const payWith = pricing.total <= 0 ? null : payChoices.includes(draft.payWith) ? draft.payWith : (payChoices[0] ?? null)
  const payOnline = Boolean(payWith && payWith !== 'venue')
  const payName = payOnline ? (onlineProviders.find((p) => p.id === payWith)?.name ?? 'online') : ''
  const providerNames = onlineProviders.filter((p) => p.id !== 'test').map((p) => p.name).join(' or ') || 'online'
  const [redirecting, setRedirecting] = useState(false)
  const paymentId = params.get('payment')

  const checkPromo = useMutation({
    mutationFn: (code: string) => ticketsApi.checkPromo(slug, code),
    onSuccess: (res) => {
      setPromo(res)
      setPromoError(null)
      setPromoInput(res.code)
      setDraft((d) => ({ ...d, promoCode: res.code }))
      // The code unlocks one hidden ticket: add it for them when the order has room
      const unlocked = res.ticket_types.filter((t) => t.unlocked && t.availability === 'on_sale')
      if (unlocked.length === 1) {
        setDraft((d) => (d.quantities[unlocked[0].id] || sumOf(d.quantities) >= cap ? d : { ...d, quantities: { ...d.quantities, [unlocked[0].id]: 1 } }))
      }
    },
    onError: (err: Error) => {
      setPromo(null)
      setDraft((d) => ({ ...d, promoCode: '' }))
      setPromoError(err.message.replace(/^[^\p{L}\p{N}']+/u, ''))
    },
  })
  // Re-apply a code saved in the draft (e.g. after a refresh)
  useEffect(() => {
    if (draft.promoCode && event.has_promo_codes) checkPromo.mutate(draft.promoCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const removePromo = () => {
    setPromo(null)
    setPromoInput('')
    setPromoError(null)
    setDraft((d) => ({ ...d, promoCode: '' }))
  }

  /** One entry per ticket, in the order the passes are made: the buyer's first. */
  const slots: TypeOption[] = pricing.lines.flatMap((l) => Array.from({ length: l.qty }, () => l.type))

  const viewingStored = params.get('view') === 'pass'
  const [registered, setRegistered] = useState<RegisteredInfo | null>(null)
  const [issued, setIssued] = useState<Issued | null>(() => {
    const stored = viewingStored ? getStoredPasses(slug) : []
    return stored.length ? { tickets: stored, existing: true } : null
  })

  // Which step the URL asks for, never past what has been validated
  const requested = Math.max(0, (Number(params.get('step')) || 1) - 1)
  const stepIdx = issued || registered ? passIdx : Math.min(requested, draft.maxReached, passIdx - 1)
  const step = steps[stepIdx]

  useEffect(() => {
    if (issued) return
    if (requested !== stepIdx) setParams((p) => (p.set('step', String(stepIdx + 1)), p), { replace: true })
  }, [requested, stepIdx, issued, setParams])

  // Keep a draft so an accidental refresh doesn't lose what was typed
  useEffect(() => {
    if (!issued) saveDraft(slug, draft)
  }, [draft, issued, slug])

  // Focus the step heading after a step change (not on first render)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const prevStep = useRef(stepIdx)
  const [direction, setDirection] = useState<1 | -1>(1)
  useEffect(() => {
    if (prevStep.current === stepIdx) return
    setDirection(stepIdx > prevStep.current ? 1 : -1)
    prevStep.current = stepIdx
    headingRef.current?.focus({ preventScroll: true })
    topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [stepIdx])

  const goTo = (i: number) => {
    setErrors({})
    setServerError(null)
    setParams((p) => (p.set('step', String(i + 1)), p.delete('view'), p))
  }

  const setField = (k: 'name' | 'email' | 'phone', v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k]) setErrors(({ [k]: _, ...r }) => r)
  }
  const setAnswer = (k: string, v: unknown) => {
    setDraft((d) => ({ ...d, answers: { ...d.answers, [k]: v } }))
    if (errors[k]) setErrors(({ [k]: _, ...r }) => r)
  }
  const setGuestName = (i: number, v: string) =>
    setDraft((d) => {
      const names = [...d.guestNames]
      while (names.length < i) names.push('')
      names[i] = v
      return { ...d, guestNames: names }
    })

  const validateStep = (id: StepId): Errors => {
    const e: Errors = {}
    if (id === 'tickets') {
      if (pricing.count < 1) e.tickets = noTicketsLeft ? 'No tickets are on sale right now.' : 'Choose at least one ticket.'
      else if (pricing.count > cap) e.tickets = `You can get up to ${plural(cap, 'ticket')} in one order.`
    }
    if (id === 'details') {
      if (!draft.name.trim()) e.name = 'Enter your full name.'
      if (!draft.email.trim()) e.email = 'Enter your email address.'
      else if (!EMAIL_RE.test(draft.email.trim())) e.email = 'Enter an email like name@example.com.'
      if (phoneRequired && !draft.phone.trim()) e.phone = 'Enter your mobile number.'
      else if (draft.phone.trim() && draft.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a valid mobile number, e.g. +977 98XXXXXXXX.'
    }
    if (id === 'questions') {
      for (const f of questions) {
        const k = keyOf(f)
        const v = draft.answers[k]
        if (f.required && isEmpty(v)) e[k] = ['radio', 'select', 'checkbox'].includes(f.field_type) ? 'Choose an option.' : 'This field is required.'
        else if (!isEmpty(v) && f.field_type === 'number' && Number.isNaN(Number(v))) e[k] = 'Enter a number.'
        else if (!isEmpty(v) && f.field_type === 'email' && !EMAIL_RE.test(String(v))) e[k] = 'Enter an email like name@example.com.'
      }
    }
    if (id === 'review') {
      for (const f of consents) if (!draft.answers[keyOf(f)]) e[keyOf(f)] = 'Tick this box to continue.'
      if (pricing.total > 0 && !payWith)
        e.payment = onlineOnlyNames.length ? `${onlineOnlyNames.join(', ')} tickets can only be paid online, which isn't available right now.` : 'Choose how to pay.'
    }
    return e
  }

  const labelFor = (k: string) =>
    ({ name: 'Full name', email: 'Email', phone: 'Mobile number', tickets: 'Tickets', payment: 'Payment' } as Record<string, string>)[k] ?? fields.find((f) => keyOf(f) === k)?.label ?? k

  const showErrors = (e: Errors) => {
    setErrors(e)
    const keys = Object.keys(e)
    toast.error(keys.length === 1 ? 'Check 1 field' : `Check ${keys.length} fields`, keys.map(labelFor).join(', '))
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        '#reg-form fieldset[data-invalid="true"] input:not(:disabled), #reg-form fieldset[data-invalid="true"] button:not(:disabled), #reg-form [aria-invalid="true"]',
      )
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  /** The order for the API: guest names go with the item their ticket belongs to. */
  const buildItems = (): RegisterItem[] => {
    let at = 0
    return pricing.lines.map((l) => {
      const guest_names: string[] = []
      for (let k = at; k < at + l.qty; k++) if (k > 0) guest_names.push((draft.guestNames[k - 1] ?? '').trim())
      at += l.qty
      return { ...(l.type.id === FREE_ID ? {} : { ticket_type_id: l.type.id }), quantity: l.qty, guest_names }
    })
  }

  const register = useMutation({
    mutationFn: () => {
      const builtinValue: Record<Builtin, string> = { name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim() }
      const payload: Answers = { ...draft.answers }
      for (const f of mapped) payload[keyOf(f)] = builtinValue[builtinOf(f)!]
      return api.registerForEvent(slug, {
        ...builtinValue,
        answers: payload,
        items: formOnly ? [{ quantity: 1, guest_names: [] }] : buildItems(),
        promo_code: pricing.promoCode ?? undefined,
        ...(draft.additional ? { additional: true } : {}),
        // Online: the provider sends the buyer back to this page (review step), where the payment is confirmed
        ...(pricing.total > 0 && payWith
          ? payOnline
            ? { payment_method: 'online' as const, provider: payWith, return_url: `${window.location.origin}${window.location.pathname}?step=${stepIdx + 1}` }
            : { payment_method: 'venue' as const }
          : {}),
      })
    },
    onSuccess: (res) => {
      if (res.registration_only && res.registration) {
        void queryClient.invalidateQueries({ queryKey: ['publicEvent', slug] })
        void queryClient.invalidateQueries({ queryKey: ['my-tickets'] })
        if (!res.already_registered) {
          saveDraft(slug, null)
          track('register_event', { event_slug: slug, ticket_count: 1, value: 0, currency: 'NPR', payment: 'free' })
        }
        setRegistered({ ...res.registration, existing: Boolean(res.already_registered) })
        setParams((p) => (p.set('step', String(passIdx + 1)), p), { replace: true })
        if (res.already_registered) toast.info("You're already registered", `${res.registration.email} is already on the list.`)
        else toast.success("You're registered", 'A confirmation is on its way to your email.')
        return
      }
      if (res.payment_required && res.checkout) {
        // Tickets are held; passes come after the provider confirms the payment
        setRedirecting(true)
        toast.info(`Taking you to ${payName}`, `Your tickets are held for ${payOpts?.hold_minutes ?? 15} minutes while you pay.`)
        goToCheckout(res.checkout)
        return
      }
      const existing = Boolean(res.already_registered)
      const got = sortPasses(res.tickets?.length ? res.tickets : [res.ticket])
      const email = res.ticket.attendee_email.toLowerCase()
      // Getting more: keep this device's earlier passes for the same email alongside the new ones
      const earlier = draft.additional && !existing ? getStoredPasses(slug).filter((t) => t.attendee_email.toLowerCase() === email && !got.some((g) => g.id === t.id)) : []
      storePasses(slug, [...earlier, ...got])
      void queryClient.invalidateQueries({ queryKey: ['publicEvent', slug] })
      void queryClient.invalidateQueries({ queryKey: ['my-tickets'] })
      // Already registered: keep what they typed, in case they want more tickets
      if (!existing) saveDraft(slug, null)
      if (!existing) track('register_event', { event_slug: slug, ticket_count: got.length, value: pricing.total, currency: 'NPR', payment: pricing.total > 0 ? 'venue' : 'free' })
      setIssued({ tickets: got, existing, orderReference: res.order?.reference, additional: draft.additional && !existing })
      setParams((p) => (p.set('step', String(passIdx + 1)), p), { replace: true })
      if (existing) toast.info("You're already registered", `${res.ticket.attendee_email} already has ${got.length === 1 ? 'a pass' : `${got.length} passes`}. Here ${got.length === 1 ? 'it is' : 'they are'} again.`)
      else toast.success("You're registered", got.length === 1 ? 'Your pass is ready. Save or print it.' : `Your ${got.length} passes are ready. Save or print them.`)
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^[^\p{L}\p{N}']+/u, '')
      setServerError(msg)
      // Availability may have changed (sold out, sales ended): refresh what we show
      void queryClient.invalidateQueries({ queryKey: ['publicEvent', slug] })
      if (promo) checkPromo.mutate(promo.code)
      toast.error("Couldn't register you", msg)
    },
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (register.isPending) return
    const found = validateStep(step)
    if (Object.keys(found).length) return showErrors(found)
    setErrors({})
    if (step === 'review') {
      setServerError(null)
      register.mutate()
      return
    }
    const next = stepIdx + 1
    setDraft((d) => ({ ...d, maxReached: Math.max(d.maxReached, next) }))
    // maxReached updates in the same render batch as the URL, so the clamp lets us through
    setParams((p) => (p.set('step', String(next + 1)), p))
  }

  /** Back from Khalti / eSewa with a confirmed payment: show the passes. */
  const onPaid = useCallback(
    (intent: PublicIntent<TicketOrderResult>) => {
      const got = sortPasses(intent.result!.tickets)
      trackTicketPurchase(intent.result!.order, intent.amount, slug, got, intent.provider) // GA4 purchase, once per order
      const email = got[0].attendee_email.toLowerCase()
      const earlier = draft.additional ? getStoredPasses(slug).filter((t) => t.attendee_email.toLowerCase() === email && !got.some((g) => g.id === t.id)) : []
      storePasses(slug, [...earlier, ...got])
      void queryClient.invalidateQueries({ queryKey: ['publicEvent', slug] })
      void queryClient.invalidateQueries({ queryKey: ['my-tickets'] })
      saveDraft(slug, null)
      setIssued({ tickets: got, existing: false, orderReference: intent.result!.order.reference, additional: draft.additional })
      setParams(
        (p) => {
          p.delete('payment')
          p.delete('status')
          p.set('step', String(passIdx + 1))
          return p
        },
        { replace: true },
      )
      toast.success('Payment received', got.length === 1 ? 'Your pass is ready. Save or print it.' : `Your ${got.length} passes are ready. Save or print them.`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.additional, slug, passIdx],
  )
  /** Payment failed or was cancelled: back to Review with everything still filled in. */
  const retryPayment = (venue = false) => {
    if (venue) setDraft((d) => ({ ...d, payWith: 'venue' }))
    setRedirecting(false)
    void queryClient.invalidateQueries({ queryKey: ['publicEvent', slug] })
    setParams((p) => {
      p.delete('payment')
      p.delete('status')
      return p
    })
  }

  const reset = () => {
    setIssued(null)
    removePromo()
    setDraft({ ...emptyDraft, quantities: startingQuantities(event, null) })
    saveDraft(slug, null)
    setErrors({})
    setServerError(null)
    setParams({ step: '1' })
  }

  /** Already registered: back to Tickets to add more passes to the same email. */
  const getMore = () => {
    const buyer = issued?.tickets.find((t) => !t.guest_number) ?? issued?.tickets[0]
    setIssued(null)
    setErrors({})
    setServerError(null)
    setDraft((d) => ({
      ...d,
      additional: true,
      // Start again from Tickets (the URL still points at the pass step until the navigation lands)
      maxReached: 0,
      name: d.name || buyer?.attendee_name || '',
      email: d.email || buyer?.attendee_email || '',
      phone: d.phone || buyer?.attendee_phone || '',
      guestNames: [],
      quantities: sumOf(d.quantities) ? d.quantities : startingQuantities(event, null),
    }))
    setParams({ step: '1' })
  }

  if (!issued && !state.open && !paymentId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Card>
          <EmptyState
            icon={state.phase === 'cancelled' ? <Ban className="h-6 w-6" aria-hidden /> : <CalendarDays className="h-6 w-6" aria-hidden />}
            title={state.phase === 'cancelled' ? 'This event was cancelled' : state.phase === 'ended' ? 'This event has ended' : (state.label ?? 'Registration is closed')}
            description={
              state.phase === 'cancelled' || state.phase === 'ended'
                ? `${state.reason} Registration is closed.`
                : `${state.reason} Contact the organizer if you think this is a mistake.`
            }
            action={
              <ButtonLink to={`/e/${slug}`} variant="secondary">
                Back to the event
              </ButtonLink>
            }
          />
        </Card>
      </div>
    )
  }

  const submitLabel =
    step === 'review' && payOnline
      ? register.isPending || redirecting
        ? `Going to ${payName}`
        : `Pay Rs ${money(pricing.total)} with ${payName}`
      : step === 'review'
      ? register.isPending
        ? 'Registering'
        : 'Register'
      : 'Continue'
  const custom = event.cta_label?.trim()
  const finalLabel = formOnly && step === 'review' ? (register.isPending ? (applying ? 'Sending' : 'Registering') : custom || (applying ? 'Submit application' : 'Register')) : submitLabel
  const submitDisabled = step === 'tickets' && pricing.count < 1
  const totalText = pricing.total > 0 ? (onlineProviders.length ? `Rs ${money(pricing.total)}` : `Pay Rs ${money(pricing.total)} at the venue`) : 'Free'
  const payLine =
    pricing.total <= 0
      ? null
      : step === 'review' && payWith
        ? payOnline
          ? `Pay Rs ${money(pricing.total)} online with ${payName}.`
          : `Pay Rs ${money(pricing.total)} at the venue when you arrive.`
        : onlineProviders.length
          ? venueAllowed
            ? `Pay Rs ${money(pricing.total)} online with ${providerNames}, or at the venue.`
            : `Pay Rs ${money(pricing.total)} online with ${providerNames}.`
          : `Pay Rs ${money(pricing.total)} at the venue. No online payment.`
  const busy = register.isPending || redirecting

  return (
    <div ref={topRef} className={cn('mx-auto max-w-6xl scroll-mt-4 px-4 py-6 sm:px-6 sm:py-10', step !== 'pass' && (step === 'tickets' ? 'pb-40 lg:pb-10' : 'pb-32 lg:pb-10'))}>
      <style>{stepMotionCss}</style>
      <Link to={`/e/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to event
      </Link>

      {/* Compact event card on phones */}
      <MiniEvent event={event} when={applying ? `Closes ${when.shortDate}` : when.shortDate} detailed={stepIdx === 0} className="mt-4 lg:hidden" />

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0">
          {state.phase === 'live' && step !== 'pass' && (
            <p className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <Radio className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                <span className="font-semibold">Happening now.</span> {formOnly ? 'You can still register.' : 'Register here and show your pass at the gate straight away.'}
              </span>
            </p>
          )}
          {draft.additional && step !== 'pass' && (
            <p className="mb-5 flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
              <TicketIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span>
                <span className="font-semibold">Getting more tickets{draft.email.trim() ? ` for ${draft.email.trim()}` : ''}.</span> Your earlier passes stay valid. These come as new passes.
              </span>
            </p>
          )}
          <Stepper steps={steps} labels={labels} current={stepIdx} maxReached={issued || registered ? passIdx : draft.maxReached} onJump={issued || registered ? undefined : goTo} />

          <div key={step} className="el-step mt-6" style={{ ['--step-dir' as string]: String(direction) }}>
            {paymentId && !issued ? (
              <PaymentReturn
                paymentId={paymentId}
                onPaid={onPaid}
                onRetry={() => retryPayment()}
                onVenue={venueAllowed ? () => retryPayment(true) : undefined}
                headingRef={headingRef}
              />
            ) : step === 'pass' && registered ? (
              <RegisteredStep event={event} dateLabel={when.shortDate} info={registered} headingRef={headingRef} />
            ) : step === 'pass' && issued ? (
              <PassStep event={event} dateLabel={when.shortDate} issued={issued} onAnother={reset} onGetMore={state.open ? getMore : undefined} headingRef={headingRef} />
            ) : (
              <Card>
                <form id="reg-form" onSubmit={onSubmit} noValidate>
                  <div className="border-b border-ink-100 px-5 py-5 sm:px-6">
                    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-ink-900 outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                      {labels[step]}
                    </h2>
                    <p className="mt-1 text-sm text-ink-500">
                      {step === 'tickets' && (orderMax > 1 ? 'Choose how many tickets you need. Each ticket is its own pass with its own QR code.' : 'Choose your ticket.')}
                      {step === 'details' && formOnly && (applying ? 'Tell us who is applying. We email you at this address.' : 'Tell us who is registering. The confirmation goes to this email.')}
                      {step === 'details' && !formOnly && (pricing.count > 1 ? 'Tell us who is buying. All passes go to this email.' : 'Tell us who is coming. Your pass is linked to this email.')}
                      {step === 'questions' && (form?.description || 'A few questions from the organizer.')}
                      {step === 'review' && formOnly && 'Check everything is right, then register.'}
                      {step === 'review' && !formOnly && (pricing.count > 1 ? 'Check everything is right, then get your passes.' : 'Check everything is right, then get your pass.')}
                    </p>
                  </div>

                  <div className="space-y-5 px-5 py-6 sm:px-6">
                    {step === 'tickets' && (
                      <>
                        <TicketsStep
                          options={options}
                          quantities={draft.quantities}
                          maxFor={maxFor}
                          onChange={setQty}
                          promo={promo}
                          error={errors.tickets}
                          noTicketsLeft={noTicketsLeft}
                          count={pricing.count}
                          cap={cap}
                          orderMax={orderMax}
                          spotsLeft={spotsLeft}
                        />
                        {event.has_promo_codes && (
                          <PromoBox
                            open={promoOpen}
                            onOpen={() => setPromoOpen(true)}
                            value={promoInput}
                            onChange={(v) => {
                              setPromoInput(v)
                              setPromoError(null)
                            }}
                            applied={promo}
                            error={promoError}
                            loading={checkPromo.isPending}
                            onApply={() => {
                              const code = promoInput.trim()
                              if (!code) return setPromoError('Enter a code first.')
                              checkPromo.mutate(code)
                            }}
                            onRemove={removePromo}
                          />
                        )}
                        <OrderSummary pricing={pricing} note={payLine} className="lg:hidden" />
                      </>
                    )}

                    {step === 'details' && (
                      <>
                        <Input
                          label="Full name"
                          required
                          autoComplete="name"
                          value={draft.name}
                          placeholder={mappedFor('name')?.placeholder || 'e.g. Aarati Rai'}
                          error={errors.name}
                          className={invalidCls}
                          onChange={(e) => setField('name', e.target.value)}
                        />
                        <div className="grid gap-5 sm:grid-cols-2">
                          <Input
                            label="Email"
                            type="email"
                            required
                            autoComplete="email"
                            inputMode="email"
                            value={draft.email}
                            placeholder="name@example.com"
                            hint={formOnly ? 'Your confirmation is sent to this email.' : pricing.count > 1 ? 'All passes are sent to this email.' : 'Your pass is linked to this email.'}
                            error={errors.email}
                            className={invalidCls}
                            onChange={(e) => setField('email', e.target.value)}
                          />
                          <Input
                            label="Mobile number"
                            type="tel"
                            required={phoneRequired}
                            autoComplete="tel"
                            value={draft.phone}
                            placeholder={mappedFor('phone')?.placeholder || '+977 98XXXXXXXX'}
                            hint={phoneRequired ? undefined : 'Optional'}
                            error={errors.phone}
                            className={invalidCls}
                            onChange={(e) => setField('phone', e.target.value)}
                          />
                        </div>
                        {simpleFree && cap > 1 && (
                          <div className="flex items-center justify-between gap-4 rounded-xl border border-ink-200 px-4 py-3">
                            <div>
                              <p className="text-sm font-semibold text-ink-900">How many people?</p>
                              <p className="text-xs text-ink-500">Including you. Everyone gets their own pass. Up to {cap}.</p>
                            </div>
                            <QtyStepper name="people" value={Math.max(1, draft.quantities[simpleFreeId!] ?? 1)} max={cap} onChange={(v) => setQty(simpleFreeId!, Math.max(1, v))} />
                          </div>
                        )}
                        {slots.length > 1 && <GuestNames slots={slots} buyer={draft.name.trim()} names={draft.guestNames} onChange={setGuestName} />}
                      </>
                    )}

                    {step === 'questions' &&
                      questions.map((f) => (
                        <DynamicField key={keyOf(f)} field={f} value={draft.answers[keyOf(f)]} error={errors[keyOf(f)]} onChange={(v) => setAnswer(keyOf(f), v)} />
                      ))}

                    {step === 'review' && (
                      <Review
                        totalLabel={payOnline ? `Rs ${money(pricing.total)}, paid online with ${payName}` : `Rs ${money(pricing.total)}, pay at the venue`}
                        payment={
                          pricing.total > 0 && (onlineProviders.length > 0 || !venueAllowed) ? (
                            <PaymentChoice
                              providers={onlineProviders}
                              venueAllowed={venueAllowed}
                              venueBlockedReason={venueBlockedReason}
                              value={payWith}
                              onChange={(v) => {
                                setDraft((d) => ({ ...d, payWith: v }))
                                if (errors.payment) setErrors(({ payment: _, ...r }) => r)
                              }}
                              total={pricing.total}
                              holdMinutes={payOpts?.hold_minutes ?? null}
                              error={errors.payment}
                            />
                          ) : null
                        }
                        pricing={pricing}
                        slots={slots}
                        draft={draft}
                        questions={questions}
                        consents={consents}
                        errors={errors}
                        serverError={serverError}
                        onEdit={(id) => goTo(steps.indexOf(id))}
                        onConsent={(k, v) => setAnswer(k, v)}
                        organizer={event.organizer_info?.name || event.organizer_name || 'the organizer'}
                        eventTermsHref={event.terms ? `/e/${event.slug}#terms` : undefined}
                      />
                    )}
                  </div>

                  {/* Desktop actions */}
                  <div className="hidden items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 sm:px-6 lg:flex">
                    {stepIdx > 0 ? (
                      <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} onClick={() => goTo(stepIdx - 1)}>
                        Back
                      </Button>
                    ) : (
                      <span className="text-sm text-ink-500">{applying ? 'Free to apply' : formOnly ? 'Free registration' : simpleFree ? `${pricing.count === 1 ? '1 person' : `${pricing.count} people`} · Free` : pricing.count > 0 ? `${plural(pricing.count, 'ticket')} · ${totalText}` : 'Add a ticket to continue'}</span>
                    )}
                    <Button type="submit" size="lg" loading={busy} disabled={submitDisabled}>
                      {finalLabel}
                    </Button>
                  </div>
                </form>
              </Card>
            )}
          </div>
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-6 lg:block">
          {/* The event banner always shows beside the form */}
          <MiniEvent event={event} when={applying ? `Closes ${when.shortDate}` : when.shortDate} detailed />
          {step !== 'pass' && !formOnly && !simpleFree && <OrderSummary pricing={pricing} note={payLine} card />}
          {step !== 'pass' && step !== 'tickets' && (draft.name.trim() || draft.email.trim()) && (
            <Card className="p-5">
              <h2 className="text-sm font-medium text-ink-500">Registering</h2>
              <p className="mt-1 break-words font-semibold text-ink-900">{draft.name.trim() || 'Name not entered'}</p>
              <p className="break-all text-sm text-ink-600">{draft.email.trim() || 'Email not entered'}</p>
              {draft.phone.trim() && <p className="text-sm text-ink-600">{draft.phone.trim()}</p>}
            </Card>
          )}
        </aside>
      </div>

      {/* Phone action bar */}
      {step !== 'pass' && !paymentId && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {step === 'tickets' && (
            <p className="mx-auto flex max-w-6xl items-baseline justify-between gap-3 px-4 pt-2.5 text-sm sm:px-6" aria-live="polite">
              <span className="text-ink-600">{formOnly ? 'Free registration' : pricing.count > 0 ? plural(pricing.count, 'ticket') : 'No tickets yet'}</span>
              {pricing.count > 0 && <span className="font-bold tabular text-ink-900">{totalText}</span>}
            </p>
          )}
          <div className="mx-auto flex max-w-6xl gap-2 px-4 py-3 sm:px-6">
            {stepIdx > 0 && (
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => goTo(stepIdx - 1)}>
                Back
              </Button>
            )}
            <Button type="submit" form="reg-form" size="lg" className="flex-[2]" loading={busy} disabled={submitDisabled}>
              {finalLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const stepMotionCss = `
@media (prefers-reduced-motion: no-preference) {
  .el-step { animation: el-step-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
}
@keyframes el-step-in {
  from { opacity: 0; transform: translateX(calc(var(--step-dir, 1) * 16px)); }
  to { opacity: 1; transform: none; }
}
`

/* ------------------------------------------------------------------ */

const Stepper: React.FC<{ steps: StepId[]; labels: Record<StepId, string>; current: number; maxReached: number; onJump?: (i: number) => void }> = ({ steps, labels, current, maxReached, onJump }) => {
  const pct = Math.round(((current + 1) / steps.length) * 100)
  return (
    <nav aria-label="Registration steps">
      {/* Phones */}
      <div className="sm:hidden">
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-900">{labels[steps[current]]}</span>
          <span className="text-ink-500">
            Step {current + 1} of {steps.length}
          </span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-label="Registration progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {/* Wider screens */}
      <ol className="hidden items-start sm:flex">
        {steps.map((s, i) => {
          const done = i < current
          const isCurrent = i === current
          const canJump = onJump && i < current && i <= maxReached
          const circle = (
            <span
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                done && 'border-brand-600 bg-brand-600 text-white',
                isCurrent && 'border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100',
                !done && !isCurrent && 'border-ink-200 bg-white text-ink-400',
              )}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
          )
          return (
            <li key={s} className="relative flex flex-1 flex-col items-center text-center" aria-current={isCurrent ? 'step' : undefined}>
              {i > 0 && <span aria-hidden className={cn('absolute right-1/2 top-[18px] h-0.5 w-full -translate-y-1/2', i <= current ? 'bg-brand-600' : 'bg-ink-200')} style={{ marginRight: 18 }} />}
              {canJump ? (
                <button type="button" onClick={() => onJump!(i)} className="relative z-10 rounded-full" aria-label={`Go back to ${labels[s]}`}>
                  {circle}
                </button>
              ) : (
                <span className="relative z-10">{circle}</span>
              )}
              <span className={cn('mt-2 text-xs font-medium sm:text-sm', isCurrent ? 'text-ink-900' : done ? 'text-ink-700' : 'text-ink-400')}>
                {labels[s]}
                {done && <span className="sr-only"> (completed)</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const MiniEvent: React.FC<{ event: PublicEvent; when: string; detailed?: boolean; className?: string }> = ({ event, when, detailed, className }) => {
  const spots = spotsInfo(event)
  const left = spots.left
  const pct = spots.capacity && left !== null ? Math.min(100, Math.round(((spots.capacity - left) / spots.capacity) * 100)) : 0
  return (
    <Card className={cn('overflow-hidden', className)}>
      {detailed && event.banner && <img src={event.banner} alt="" className="aspect-[16/7] w-full border-b border-ink-200 object-cover" />}
      <div className="flex gap-3 p-4 sm:p-5">
        {!detailed && event.banner && <img src={event.banner} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold leading-tight text-ink-900">{event.title}</p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-600">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {when}
          </p>
          <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-600">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span className="min-w-0">{event.location}</span>
          </p>
          {detailed && (
            <div className="mt-4 border-t border-ink-100 pt-4 text-sm">
              <p className="flex items-baseline justify-between">
                <span className="font-semibold text-ink-900">{priceLabel(event)}</span>
                <span className="text-ink-500">{spots.full ? 'Fully booked' : spots.hidden ? 'Spots available' : left === null ? 'Open to everyone' : `${left.toLocaleString()} spots left`}</span>
              </p>
              {left !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="meter" aria-label="Spots taken" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : 'bg-brand-600')} style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
              )}
              {hasPaidTickets(event) && <p className="mt-2 text-xs text-ink-500">{paymentNote(event.payment_options)}</p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

const Review: React.FC<{
  /** Total row, e.g. "Rs 1,000, paid online with Khalti" */
  totalLabel: string
  /** How-to-pay picker (online providers / venue) */
  payment: React.ReactNode
  pricing: Pricing
  slots: TypeOption[]
  draft: Draft
  questions: FormField[]
  consents: FormField[]
  errors: Errors
  serverError: string | null
  onEdit: (id: StepId) => void
  onConsent: (key: string, v: boolean) => void
  /** Who receives the registration (shown in the agreement line) */
  organizer: string
  /** The event's own terms & conditions, when the organizer wrote some */
  eventTermsHref?: string
}> = ({ totalLabel, payment, pricing, slots, draft, questions, consents, errors, serverError, onEdit, onConsent, organizer, eventTermsHref }) => {
  const paid = pricing.total > 0
  const buyer = draft.name.trim()
  return (
    <div className="space-y-5">
      {serverError && (
        <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>We couldn't register you: {serverError}</p>
        </div>
      )}
      <ReviewGroup title="Tickets" onEdit={() => onEdit('tickets')}>
        {pricing.lines.map((l) => (
          <ReviewRow key={l.type.id} label={`${l.qty} × ${l.type.name}`} value={priceText(l.qty * Number(l.type.price))} />
        ))}
        {pricing.discount > 0 && <ReviewRow label={`Discount · ${pricing.promoCode}`} value={`− Rs ${money(pricing.discount)}`} />}
        {!pricing.discount && pricing.promoCode && <ReviewRow label="Promo code" value={pricing.promoCode} />}
        <ReviewRow label="Total" value={paid ? totalLabel : 'Free'} />
      </ReviewGroup>
      <ReviewGroup title="Your details" onEdit={() => onEdit('details')}>
        <ReviewRow label="Full name" value={buyer} />
        <ReviewRow label="Email" value={draft.email.trim()} />
        <ReviewRow label="Mobile number" value={draft.phone.trim() || 'Not given'} />
      </ReviewGroup>
      {slots.length > 1 && (
        <ReviewGroup title={`Passes (${slots.length})`} onEdit={() => onEdit('details')}>
          {slots.map((t, i) => (
            <ReviewRow
              key={i}
              label={`Ticket ${i + 1} · ${t.name}`}
              value={i === 0 ? `${buyer} (you)` : draft.guestNames[i - 1]?.trim() || `${buyer} · Guest ${i + 1}`}
            />
          ))}
        </ReviewGroup>
      )}
      {questions.length > 0 && (
        <ReviewGroup title="Event questions" onEdit={() => onEdit('questions')}>
          {questions.map((f) => (
            <ReviewRow key={keyOf(f)} label={f.label} value={answerText(draft.answers[keyOf(f)])} />
          ))}
        </ReviewGroup>
      )}
      {paid &&
        (payment ?? (
          <p className="rounded-xl bg-marigold-50 px-4 py-3 text-sm text-marigold-900">
            Pay Rs {money(pricing.total)} at the venue when you arrive. There's no online payment for this event.
          </p>
        ))}
      {consents.map((f) => {
        const k = keyOf(f)
        return (
          <div key={k} className="space-y-1.5">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 text-sm text-ink-800 hover:bg-ink-50">
              <input
                type="checkbox"
                checked={Boolean(draft.answers[k])}
                onChange={(e) => onConsent(k, e.target.checked)}
                aria-invalid={errors[k] ? true : undefined}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span>
                {f.label}
                <span className="ml-0.5 text-brand-600" aria-hidden>
                  *
                </span>
                {f.help_text && <span className="mt-0.5 block text-xs text-ink-500">{f.help_text}</span>}
              </span>
            </label>
            {errors[k] && <p className="text-xs font-medium text-red-600">{errors[k]}</p>}
          </div>
        )
      })}
      <p className="text-xs leading-relaxed text-ink-500">
        By registering you agree to the{' '}
        {eventTermsHref && (
          <>
            <a href={eventTermsHref} target="_blank" rel="noreferrer" className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900">
              event’s terms & conditions
            </a>
            , the Eventlaya{' '}
          </>
        )}
        <LegalLink path={LEGAL_PATHS.terms} newTab className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900">
          Terms
        </LegalLink>{' '}
        and that your details are shared with {organizer}.{' '}
        <LegalLink path={LEGAL_PATHS.privacy} newTab className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900">
          Privacy policy
        </LegalLink>
      </p>
    </div>
  )
}

/* ---------- tickets step ---------- */

const TicketsStep: React.FC<{
  options: TypeOption[]
  quantities: Record<string, number>
  maxFor: (t: TypeOption) => number
  onChange: (id: string, qty: number) => void
  promo: PromoCheck | null
  error?: string
  noTicketsLeft: boolean
  count: number
  cap: number
  orderMax: number
  spotsLeft: number | null
}> = ({ options, quantities, maxFor, onChange, promo, error, noTicketsLeft, count, cap, orderMax, spotsLeft }) => {
  if (noTicketsLeft) {
    return (
      <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          No tickets are on sale right now.{' '}
          {options.map((t) => `${t.name}: ${(availabilityText(t) ?? 'unavailable').toLowerCase()}`).join('. ')}
          {options.length ? '.' : ''}
        </p>
      </div>
    )
  }
  const atCap = count >= cap
  return (
    <fieldset data-invalid={error ? 'true' : undefined} className="space-y-3" aria-describedby={error ? 'tickets-error' : 'tickets-hint'}>
      <legend className="sr-only">Tickets</legend>
      <ul className="space-y-2.5">
        {options.map((t) => {
          const reason = availabilityText(t)
          const disabled = Boolean(reason)
          const qty = disabled ? 0 : (quantities[t.id] ?? 0)
          const max = disabled ? 0 : maxFor(t)
          const discounted = Boolean(promo && t.promo_applies && Number(t.discounted_price) !== Number(t.price))
          const extras: string[] = []
          if (!disabled && t.remaining !== null && t.remaining <= 20) extras.push(t.remaining === 0 ? 'None left' : `Only ${t.remaining} left`)
          if (!disabled && t.sales_end) extras.push(`Ends ${fmtShortDate(t.sales_end)}`)
          if (!disabled && t.online_only) extras.push('Pay online only')
          return (
            <li
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3.5 text-sm transition-colors sm:p-4',
                disabled ? 'border-dashed border-ink-200 bg-ink-50 text-ink-400' : qty > 0 ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-ink-200 bg-white',
                error && !disabled && qty === 0 && 'border-red-300',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn('font-semibold', disabled ? 'text-ink-500' : 'text-ink-900')}>{t.name}</span>
                  <PriceTag option={t} discounted={discounted} muted={disabled} />
                </p>
                {t.description && <p className={cn('mt-0.5 text-xs', disabled ? 'text-ink-400' : 'text-ink-500')}>{t.description}</p>}
                {(reason || t.unlocked || extras.length > 0) && (
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {reason && <span className="rounded-full bg-ink-200/70 px-2 py-0.5 text-[11px] font-medium text-ink-600">{reason}</span>}
                    {t.unlocked && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-800">Unlocked by your code</span>}
                    {extras.map((x) => (
                      <span key={x} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700">
                        {x}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {disabled ? null : <QtyStepper name={t.name} value={qty} max={max} onChange={(v) => onChange(t.id, v)} />}
            </li>
          )
        })}
      </ul>
      {error ? (
        <p id="tickets-error" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : (
        cap > 1 && (
          <p id="tickets-hint" className={cn('flex items-center gap-1.5 text-xs', atCap ? 'font-medium text-marigold-800' : 'text-ink-500')} aria-live="polite">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {count} of {cap} tickets
            {atCap
              ? spotsLeft !== null && spotsLeft < orderMax
                ? `. Only ${plural(spotsLeft, 'spot')} left for this event.`
                : '. That’s the most for one order.'
              : spotsLeft !== null && spotsLeft < orderMax
                ? ` · only ${plural(spotsLeft, 'spot')} left for this event`
                : ` · up to ${orderMax} per order`}
          </p>
        )
      )}
    </fieldset>
  )
}

const QtyStepper: React.FC<{ name: string; value: number; max: number; onChange: (v: number) => void }> = ({ name, value, max, onChange }) => (
  <div className="flex shrink-0 items-center rounded-xl border border-ink-200 bg-white shadow-2xs" role="group" aria-label={`${name} tickets`}>
    <button
      type="button"
      onClick={() => onChange(value - 1)}
      disabled={value <= 0}
      aria-label={`One fewer ${name} ticket`}
      className="flex h-10 w-10 items-center justify-center rounded-l-xl text-ink-700 hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
    >
      <Minus className="h-4 w-4" aria-hidden />
    </button>
    <output className={cn('w-9 text-center text-base font-bold tabular', value > 0 ? 'text-brand-700' : 'text-ink-500')} aria-live="polite" aria-label={`${value} ${name}`}>
      {value}
    </output>
    <button
      type="button"
      onClick={() => onChange(value + 1)}
      disabled={value >= max}
      aria-label={`One more ${name} ticket`}
      className="flex h-10 w-10 items-center justify-center rounded-r-xl text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
    >
      <Plus className="h-4 w-4" aria-hidden />
    </button>
  </div>
)

const PriceTag: React.FC<{ option: TypeOption; discounted: boolean; muted?: boolean }> = ({ option, discounted, muted }) => (
  <span className="tabular">
    {discounted && <s className="mr-1.5 text-xs text-ink-400">{priceText(option.price)}</s>}
    <span className={cn('font-bold', muted ? 'text-ink-400' : discounted ? 'text-emerald-700' : 'text-ink-900')}>{priceText(dueFor(option))}</span>
  </span>
)

const OrderSummary: React.FC<{ pricing: Pricing; note?: string | null; card?: boolean; className?: string }> = ({ pricing, note, card, className }) => {
  const body = (
    <>
      <h3 className="text-sm font-semibold text-ink-900">Order summary</h3>
      {pricing.count === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No tickets yet. Use + to add tickets.</p>
      ) : (
        <>
          <dl className="mt-3 space-y-1.5 text-sm">
            {pricing.lines.map((l) => (
              <div key={l.type.id} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-ink-700">
                  {l.qty} × {l.type.name}
                </dt>
                <dd className="shrink-0 tabular font-medium text-ink-900">{priceText(l.qty * Number(l.type.price))}</dd>
              </div>
            ))}
            {pricing.discount > 0 && (
              <div className="flex items-baseline justify-between gap-3 text-emerald-700">
                <dt className="min-w-0">
                  Discount · <span className="font-mono font-semibold">{pricing.promoCode}</span>
                </dt>
                <dd className="shrink-0 tabular font-medium">− Rs {money(pricing.discount)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-3">
            <span className="text-sm font-semibold text-ink-900">Total</span>
            <span className="text-lg font-bold tabular text-ink-900">{pricing.total > 0 ? `Rs ${money(pricing.total)}` : 'Free'}</span>
          </p>
          <p className={cn('mt-2 rounded-lg px-3 py-2 text-sm', pricing.total > 0 ? 'bg-marigold-50 text-marigold-900' : 'bg-emerald-50 text-emerald-900')}>
            {pricing.total > 0 ? (
              note ? (
                note
              ) : (
                <>
                  Pay <span className="font-bold">Rs {money(pricing.total)}</span> at the venue. No online payment.
                </>
              )
            ) : (
              <span className="font-semibold">Free. Nothing to pay.</span>
            )}
          </p>
          {pricing.promoUnused && <p className="mt-2 text-xs text-marigold-800">Your promo code doesn't apply to the tickets you picked, so it won't be used.</p>}
        </>
      )}
    </>
  )
  return card ? <Card className={cn('p-5', className)}>{body}</Card> : <section className={cn('rounded-xl border border-ink-200 p-4', className)}>{body}</section>
}

const GuestNames: React.FC<{ slots: TypeOption[]; buyer: string; names: string[]; onChange: (i: number, v: string) => void }> = ({ slots, buyer, names, onChange }) => {
  const who = buyer || 'Asha Rai'
  return (
    <fieldset className="space-y-4 rounded-xl border border-ink-200 p-4 sm:p-5">
      <legend className="-ml-1 px-1 text-sm font-semibold text-ink-900">
        Guest names <span className="font-normal text-ink-500">(optional)</span>
      </legend>
      <p className="-mt-1 text-sm text-ink-600">
        Each ticket gets its own pass, and all of them come to your email. Add names so passes are easy to hand out, or leave them blank.
      </p>
      <p className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 text-sm">
        <span className="text-ink-600">Ticket 1 · {slots[0].name}</span>
        <span className="min-w-0 truncate font-medium text-ink-900">{buyer ? `${buyer} (you)` : 'You'}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {slots.slice(1).map((t, i) => (
          <Input
            key={i}
            label={`Ticket ${i + 2} · ${t.name}`}
            autoComplete="off"
            maxLength={255}
            value={names[i] ?? ''}
            placeholder={`${who} · Guest ${i + 2}`}
            onChange={(e) => onChange(i, e.target.value)}
          />
        ))}
      </div>
    </fieldset>
  )
}

const PromoBox: React.FC<{
  open: boolean
  onOpen: () => void
  value: string
  onChange: (v: string) => void
  applied: PromoCheck | null
  error: string | null
  loading: boolean
  onApply: () => void
  onRemove: () => void
}> = ({ open, onOpen, value, onChange, applied, error, loading, onApply, onRemove }) => {
  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        <span className="flex min-w-0 items-center gap-2">
          <Tag className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-mono font-bold">{applied.code}</span> applied · {applied.label}
          </span>
        </span>
        <button type="button" onClick={onRemove} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium hover:bg-emerald-100">
          <X className="h-3.5 w-3.5" aria-hidden />
          Remove
        </button>
      </div>
    )
  }
  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <Tag className="h-4 w-4" aria-hidden />
        Have a promo code?
      </button>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <Input
        label="Promo code"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. FRIENDS10"
        containerClassName="min-w-0 flex-1 sm:max-w-xs"
        className="font-mono uppercase"
        value={value}
        error={error ?? undefined}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          // Enter applies the code instead of submitting the whole step
          if (e.key === 'Enter') {
            e.preventDefault()
            onApply()
          }
        }}
      />
      <Button type="button" variant="secondary" className="mt-[26px] shrink-0" loading={loading} onClick={onApply}>
        Apply
      </Button>
    </div>
  )
}

const ReviewGroup: React.FC<{ title: string; onEdit?: () => void; children: React.ReactNode }> = ({ title, onEdit, children }) => (
  <section className="rounded-xl border border-ink-200">
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {onEdit && (
        <button type="button" onClick={onEdit} className="text-sm font-medium text-brand-700 hover:underline">
          Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      )}
    </div>
    <dl className="divide-y divide-ink-100">{children}</dl>
  </section>
)

const ReviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
    <dt className="text-ink-500">{label}</dt>
    <dd className={cn('break-words', value === 'Not answered' || value === 'Not given' ? 'text-ink-400' : 'font-medium text-ink-900')}>{value}</dd>
  </div>
)

const PassStep: React.FC<{
  event: PublicEvent
  dateLabel: string
  issued: Issued
  onAnother: () => void
  onGetMore?: () => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}> = ({ event, dateLabel, issued, onAnother, onGetMore, headingRef }) => {
  const toast = useToast()
  const { tickets, existing } = issued
  const first = tickets[0]
  const many = tickets.length > 1
  const meta = { eventTitle: event.title, eventLocation: event.location, eventDate: dateLabel }
  const orderRef = issued.orderReference ?? (new Set(tickets.map((t) => t.order_reference)).size === 1 ? first.order_reference : null)

  const share = async () => {
    const r = await shareOrCopy({
      title: event.title,
      text: `I'm going to ${event.title} (${dateLabel}). Register here:`,
      url: `${window.location.origin}/e/${event.slug}`,
    })
    if (r === 'shared' || r === 'copied') track('share', { method: r === 'shared' ? 'native' : 'copy_link', content_type: 'event', item_id: event.slug })
    if (r === 'copied') toast.success('Event link copied', 'Paste it to invite friends.')
    else if (r === 'failed') toast.error("Couldn't share", 'Copy the address from your browser bar instead.')
  }

  const heading = existing ? "You're already registered" : issued.additional ? `You got ${plural(tickets.length, 'more pass', 'more passes')}` : "You're registered"
  const sub = existing
    ? `${first.attendee_email} has ${many ? `${tickets.length} passes` : 'a pass'} for this event. Here ${many ? 'they are' : 'it is'}.`
    : many
      ? `${tickets.length} passes, each with its own QR code. Every pass is scanned once at the gate. We also emailed them to ${first.attendee_email}.`
      : 'Save or print your pass, then show it at the gate.'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-ink-900 outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
            {heading}
          </h2>
          <p className="mt-1 text-ink-600">{sub}</p>
          {orderRef && (
            <p className="mt-1.5 text-sm text-ink-500">
              Order <span className="font-mono font-semibold text-ink-800">{orderRef}</span>
            </p>
          )}
          {first.payment && first.payment.status !== 'free' && (
            <p
              className={cn(
                'mt-2 inline-flex rounded-lg px-2.5 py-1 text-sm font-semibold',
                first.payment.status === 'paid' ? 'bg-emerald-50 text-emerald-800' : 'bg-marigold-50 text-marigold-900',
              )}
            >
              {first.payment.label}
            </p>
          )}
        </div>
      </div>

      {existing && onGetMore && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-sm text-brand-900">Bringing more people? Get more tickets on the same email. Your passes here stay valid.</p>
          <Button size="md" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onGetMore}>
            Get more tickets
          </Button>
        </div>
      )}

      <PrintablePasses tickets={tickets} {...meta} />

      {many ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" icon={<Printer className="h-5 w-5" aria-hidden />} onClick={() => window.print()}>
              Save or print all passes
            </Button>
            <DownloadAllPassesButton tickets={tickets} {...meta} size="lg" />
          </div>
          <ol className="space-y-6">
            {tickets.map((t, i) => (
              <li key={t.id} className="space-y-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-ink-900">
                    Pass {i + 1} of {tickets.length}
                    <span className="font-normal text-ink-500"> · {t.guest_number ? `Guest ${t.guest_number + 1}` : 'Your pass'}</span>
                  </span>
                  <span className="font-mono text-xs text-ink-500">{t.ticket_number}</span>
                </p>
                <TicketPass ticket={t} {...meta} />
                <DownloadPassButton ticket={t} {...meta} size="sm" label="Download this pass" />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <TicketPass ticket={first} {...meta} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" icon={<Printer className="h-5 w-5" aria-hidden />} onClick={() => window.print()}>
              Save or print your pass
            </Button>
            <DownloadPassButton ticket={first} {...meta} size="lg" />
          </div>
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          icon={<CalendarPlus className="h-5 w-5" aria-hidden />}
          onClick={() => {
            downloadIcs(event, first)
            toast.success('Calendar file downloaded', 'Open it to add the event to your calendar.')
          }}
        >
          Add to calendar
        </Button>
        <Button variant="secondary" size="lg" icon={<Share2 className="h-5 w-5" aria-hidden />} onClick={share}>
          Share event
        </Button>
        <Button variant="ghost" size="lg" icon={<UserPlus className="h-5 w-5" aria-hidden />} onClick={onAnother}>
          Register someone else
        </Button>
      </div>
      <AccountNote email={first.attendee_email} many={many} />
      <p className="flex items-start gap-2 text-sm text-ink-500">
        <TicketIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {many ? 'These passes are saved on this device.' : 'This pass is saved on this device.'} Take a screenshot too, in case you have no signal at the venue.
      </p>
    </div>
  )
}

/** Whether the pass went to the signed-in account (it does when the account's verified email registered). */
const AccountNote: React.FC<{ email: string; many?: boolean }> = ({ email, many }) => {
  const { user } = useAuth()
  if (!user || user.email.toLowerCase() !== email.toLowerCase()) return null
  if (user.email_verified) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="font-semibold">Saved to your account.</span>
        <Link to="/app/my/tickets" className="font-medium underline underline-offset-2">
          See my tickets
        </Link>
      </p>
    )
  }
  return (
    <p className="rounded-xl bg-marigold-50 px-3.5 py-2.5 text-sm text-marigold-900">
      <Link to="/verify-email?next=/app/my/tickets" className="font-semibold underline underline-offset-2">
        Verify your email
      </Link>{' '}
      to keep {many ? 'these passes' : 'this pass'} in your account.
    </p>
  )
}

/* ---------- dynamic fields ---------- */

const DynamicField: React.FC<{ field: FormField; value: unknown; error?: string; onChange: (v: unknown) => void }> = ({ field: f, value, error, onChange }) => {
  const common = { label: f.label, required: f.required, error, hint: f.help_text || undefined, className: invalidCls }
  switch (f.field_type) {
    case 'paragraph':
      return <Textarea {...common} rows={3} placeholder={f.placeholder} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'select':
      return (
        <Select {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.placeholder || 'Choose an option'}</option>
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )
    case 'radio':
    case 'checkbox': {
      if (f.field_type === 'checkbox' && !f.options?.length) {
        return (
          <div className="space-y-1.5">
            <label className="flex items-start gap-3 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(e.target.checked)}
                aria-invalid={error ? true : undefined}
                className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-brand-600"
              />
              <span>{f.label}</span>
            </label>
            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          </div>
        )
      }
      return <ChoiceGroup field={f} value={value} error={error} onChange={onChange} />
    }
    default: {
      const type = f.field_type === 'number' ? 'number' : f.field_type === 'email' ? 'email' : f.field_type === 'phone' ? 'tel' : f.field_type === 'date' ? 'date' : 'text'
      return <Input {...common} type={type} placeholder={f.placeholder} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    }
  }
}

const ChoiceGroup: React.FC<{ field: FormField; value: unknown; error?: string; onChange: (v: unknown) => void }> = ({ field: f, value, error, onChange }) => {
  const multi = f.field_type === 'checkbox'
  const selected = multi ? ((value as string[]) ?? []) : value
  const errId = `err-${keyOf(f)}`
  const hintId = `hint-${keyOf(f)}`
  return (
    <fieldset data-invalid={error ? 'true' : undefined} aria-describedby={error ? errId : f.help_text ? hintId : undefined} className="space-y-2">
      <legend className="float-left mb-2 w-full text-sm font-medium text-ink-800">
        {f.label}
        {f.required && (
          <span className="ml-0.5 text-brand-600" aria-hidden>
            *
          </span>
        )}
        {f.required && <span className="sr-only"> (required)</span>}
      </legend>
      <div className="clear-left flex flex-wrap gap-2">
        {f.options?.map((o) => {
          const checked = multi ? (selected as string[]).includes(o) : selected === o
          return (
            <label
              key={o}
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-sm transition-colors',
                checked ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-800 hover:border-ink-300',
                error && !checked && 'border-red-300',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
              )}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`field-${keyOf(f)}`}
                value={o}
                checked={checked}
                onChange={(e) => {
                  if (!multi) return onChange(o)
                  const cur = selected as string[]
                  onChange(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))
                }}
                className="h-4 w-4 accent-brand-600"
              />
              {o}
            </label>
          )
        })}
      </div>
      {error ? (
        <p id={errId} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : f.help_text ? (
        <p id={hintId} className="text-xs text-ink-500">
          {f.help_text}
        </p>
      ) : null}
    </fieldset>
  )
}

/** Registration-only events: confirmation instead of a pass (nothing to show at the gate). */
const RegisteredStep: React.FC<{ event: PublicEvent; dateLabel: string; info: RegisteredInfo; headingRef: React.RefObject<HTMLHeadingElement | null> }> = ({
  event,
  dateLabel,
  info,
  headingRef,
}) => (
  <Card className="p-6 text-center sm:p-8">
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
      <Check className="h-7 w-7" aria-hidden />
    </span>
    <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-2xl font-bold text-ink-900 outline-none">
      {event.registration_mode === 'apply' ? (info.existing ? 'You’ve already applied' : 'Application received') : info.existing ? 'You’re already registered' : 'You’re registered'}
    </h2>
    <p className="mt-2 text-ink-600">
      {event.registration_mode === 'apply' ? (
        <>
          {info.name}, your application for <span className="font-semibold text-ink-900">{event.title}</span> is in.
        </>
      ) : (
        <>
          {info.name}, you’re on the list for <span className="font-semibold text-ink-900">{event.title}</span> ({dateLabel}).
        </>
      )}
    </p>
    <p className="mt-1 text-sm text-ink-500">
      {event.registration_mode === 'apply' ? 'Application' : 'Registration'} no. <span className="font-mono font-semibold text-ink-800">{info.number}</span>. A confirmation was sent to {info.email}.{' '}
      {event.registration_mode === 'apply' ? 'You’ll get another email once the organizer reviews it.' : 'No ticket or pass is needed.'}
    </p>
    <ButtonLink to={`/e/${event.slug}`} variant="secondary" className="mt-6">
      Back to the event
    </ButtonLink>
  </Card>
)
