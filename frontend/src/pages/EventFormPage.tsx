import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Ban,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  ExternalLink,
  Link2,
  MapPin,
  Plus,
  Ticket as TicketIcon,
  Trash2,
  Users,
} from 'lucide-react'
import { api, request, type Event } from '@/services/api'
import { eventPhase } from '@/lib/phase'
import { useCurrentEvent } from '@/lib/event-context'
import { eventPageApi, useEventCategories, fmtClock, type EventCategory, type EventPageContent } from '@/lib/event-page'
import { eventPriceLabel, priceText, ticketKeys, ticketsApi } from '@/lib/tickets'
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ImageUpload, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useModuleEnabled } from '@/lib/modules'

/* ---------- draft shape ---------- */

interface EventDraft {
  title: string
  tagline: string
  category: EventCategory
  description: string
  banner: string | null
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  location: string
  map_query: string
  capacity: string
  status: Event['status']
  allow_registration: boolean
  show_spots_left: boolean
  show_managed_by: boolean
  ticket_layout: 'vertical' | 'landscape'
  show_seat_number: boolean
  parent: string
  managed_by: string
  managed_by_logo: string
  registration_deadline: string // datetime-local value
  is_paid: boolean
  ticket_price: string
}

interface Row {
  key: string
}
interface AgendaRow extends Row {
  day: string
  start_time: string
  end_time: string
  title: string
  location: string
  speaker_names: string
  description: string
}
interface SpeakerRow extends Row {
  name: string
  role: string
  organization: string
  photo_url: string | null
  bio: string
}
interface FaqRow extends Row {
  question: string
  answer: string
}
interface HighlightRow extends Row {
  text: string
}
interface PageDraft {
  highlights: HighlightRow[]
  contact_email: string
  contact_phone: string
  agenda: AgendaRow[]
  speakers: SpeakerRow[]
  faqs: FaqRow[]
  terms: string
}

type Errors = Record<string, string>

const newKey = () => Math.random().toString(36).slice(2, 10)

const emptyDraft: EventDraft = {
  title: '',
  tagline: '',
  category: 'other',
  description: '',
  banner: null,
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  location: '',
  map_query: '',
  capacity: '200',
  status: 'published',
  allow_registration: true,
  show_spots_left: true,
  show_managed_by: false,
  ticket_layout: 'vertical',
  show_seat_number: false,
  parent: '',
  managed_by: '',
  managed_by_logo: '',
  registration_deadline: '',
  is_paid: false,
  ticket_price: '',
}
const emptyPage: PageDraft = { highlights: [], contact_email: '', contact_phone: '', agenda: [], speakers: [], faqs: [], terms: '' }

const fieldNames: Record<string, string> = {
  title: 'Event name',
  tagline: 'Tagline',
  start_date: 'Start date',
  end_date: 'End date',
  end_time: 'End time',
  location: 'Venue',
  capacity: 'Capacity',
  registration_deadline: 'Registration deadline',
  ticket_price: 'Ticket price',
  contact_email: 'Contact email',
}

const statusOptions: { value: Event['status']; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'ongoing', label: 'Happening now' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** ISO timestamp → value for <input type="datetime-local"> in the browser's timezone */
function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromEvent(ev: Event, page?: EventPageContent): EventDraft {
  const e = ev as Event & { tagline?: string; category?: EventCategory }
  return {
    title: ev.title,
    tagline: page?.tagline ?? e.tagline ?? '',
    category: page?.category ?? e.category ?? 'other',
    description: ev.description ?? '',
    banner: ev.banner || null,
    start_date: ev.start_date,
    start_time: ev.start_time?.slice(0, 5) ?? '',
    end_date: ev.end_date ?? '',
    end_time: ev.end_time?.slice(0, 5) ?? '',
    location: ev.location,
    map_query: page?.map_query ?? '',
    capacity: String(ev.capacity),
    status: ev.status,
    allow_registration: ev.allow_registration,
    show_spots_left: ev.show_spots_left ?? true,
    show_managed_by: ev.show_managed_by ?? false,
    ticket_layout: ev.ticket_layout ?? 'vertical',
    show_seat_number: ev.show_seat_number ?? false,
    parent: ev.parent ?? '',
    managed_by: ev.managed_by ?? '',
    managed_by_logo: ev.managed_by_logo ?? '',
    registration_deadline: toLocalInput(ev.registration_deadline),
    is_paid: ev.is_paid,
    ticket_price: ev.is_paid ? String(Number(ev.ticket_price)) : '',
  }
}

function pageFromContent(p?: EventPageContent): PageDraft {
  if (!p) return emptyPage
  return {
    highlights: (p.highlights ?? []).map((text) => ({ key: newKey(), text })),
    contact_email: p.contact_email ?? '',
    contact_phone: p.contact_phone ?? '',
    terms: p.terms ?? '',
    agenda: (p.agenda ?? []).map((a) => ({
      key: a.id ?? newKey(),
      day: a.day ?? '',
      start_time: a.start_time?.slice(0, 5) ?? '',
      end_time: a.end_time?.slice(0, 5) ?? '',
      title: a.title,
      location: a.location ?? '',
      speaker_names: a.speaker_names ?? '',
      description: a.description ?? '',
    })),
    speakers: (p.speakers ?? []).map((s) => ({
      key: s.id ?? newKey(),
      name: s.name,
      role: s.role ?? '',
      organization: s.organization ?? '',
      photo_url: s.photo_url || null,
      bio: s.bio ?? '',
    })),
    faqs: (p.faqs ?? []).map((f) => ({ key: f.id ?? newKey(), question: f.question, answer: f.answer })),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ---------- steps ---------- */

type StepId = 'basics' | 'when' | 'registration' | 'page' | 'schedule' | 'speakers' | 'faqs' | 'review'
const STEPS: { id: StepId; label: string; description: string; required?: boolean }[] = [
  { id: 'basics', label: 'Basics', description: 'What people see first on the event page.', required: true },
  { id: 'when', label: 'Date & venue', description: 'Leave the end date empty for a one-day event.', required: true },
  { id: 'registration', label: 'Registration', description: 'Who can sign up, how many, and until when.', required: true },
  { id: 'page', label: 'Event page', description: 'Highlights and contact details for attendees. Optional.' },
  { id: 'schedule', label: 'Schedule', description: 'The running order. Shown as a timeline, by day. Optional.' },
  { id: 'speakers', label: 'Speakers', description: 'Speakers, performers or guests. Optional.' },
  { id: 'faqs', label: 'FAQs & terms', description: 'Common questions, and the terms & conditions attendees agree to. Optional.' },
  { id: 'review', label: 'Review & publish', description: 'Check everything, then save.' },
]
const REQUIRED: StepId[] = ['basics', 'when', 'registration']

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Which step holds a field, so server errors can send the user there. */
const FIELD_STEP: Record<string, StepId> = {
  title: 'basics', tagline: 'basics', parent: 'basics', category: 'basics', description: 'basics', banner: 'basics', banner_url: 'basics',
  start_date: 'when', start_time: 'when', end_date: 'when', end_time: 'when', location: 'when', map_query: 'when',
  capacity: 'registration', show_spots_left: 'registration', status: 'registration', registration_deadline: 'registration', ticket_price: 'registration', is_paid: 'registration', allow_registration: 'registration', ticket_layout: 'registration', show_seat_number: 'registration',
  managed_by: 'page', managed_by_logo: 'page', show_managed_by: 'page',
}

function validateStep(id: StepId, d: EventDraft, p: PageDraft, isNew = false): Errors {
  const e: Errors = {}
  if (id === 'basics') {
    if (!d.title.trim()) e.title = 'Give the event a name.'
    if (d.tagline.length > 160) e.tagline = 'Keep the tagline to 160 characters or fewer.'
  }
  if (id === 'when') {
    if (!d.start_date) e.start_date = 'Pick the day the event starts.'
    else if (isNew && d.start_date < localToday()) e.start_date = 'The start date can’t be in the past.'
    if (d.end_date && d.start_date && d.end_date < d.start_date) e.end_date = 'End date can’t be before the start date.'
    const sameDay = !d.end_date || d.end_date === d.start_date
    if (sameDay && d.start_time && d.end_time && d.end_time <= d.start_time) e.end_time = 'End time must be after the start time.'
    if (!d.location.trim()) e.location = 'Add the venue so attendees know where to go.'
  }
  if (id === 'registration') {
    const cap = Number(d.capacity)
    if (!d.capacity || !Number.isInteger(cap) || cap <= 0) e.capacity = 'Enter a whole number greater than 0.'
    if (d.registration_deadline) {
      const last = d.end_date || d.start_date
      if (last && d.registration_deadline.slice(0, 10) > last) e.registration_deadline = 'The deadline must be on or before the last day of the event.'
    }
    if (d.is_paid) {
      const price = Number(d.ticket_price)
      if (!d.ticket_price || Number.isNaN(price) || price <= 0) e.ticket_price = 'Enter a price greater than 0, or turn off paid tickets.'
    }
  }
  if (id === 'page') {
    if (p.contact_email.trim() && !EMAIL_RE.test(p.contact_email.trim())) e.contact_email = 'Enter an email like hello@example.com.'
    if (d.show_managed_by && !d.managed_by.trim()) e.managed_by = 'Enter who manages the event, or turn this off.'
    p.highlights.forEach((h) => h.text.length > 120 && (e[`highlight.${h.key}`] = 'Keep each highlight to 120 characters or fewer.'))
  }
  if (id === 'schedule') {
    p.agenda.forEach((a, i) => {
      if (!a.title.trim()) e[`agenda.${a.key}.title`] = `Give item ${i + 1} a title.`
      if (!a.start_time) e[`agenda.${a.key}.start_time`] = 'Add a start time.'
      else if (a.end_time && a.end_time <= a.start_time) e[`agenda.${a.key}.end_time`] = 'End time must be after the start time.'
    })
  }
  if (id === 'speakers') p.speakers.forEach((s, i) => !s.name.trim() && (e[`speaker.${s.key}.name`] = `Add a name for speaker ${i + 1}.`))
  if (id === 'faqs') {
    p.faqs.forEach((f, i) => {
      if (!f.question.trim()) e[`faq.${f.key}.question`] = `Write question ${i + 1}.`
      if (!f.answer.trim()) e[`faq.${f.key}.answer`] = `Answer question ${i + 1}.`
    })
  }
  return e
}

const errorLabel = (k: string) => fieldNames[k] ?? (k.startsWith('agenda') ? 'Schedule item' : k.startsWith('speaker') ? 'Speaker' : k.startsWith('faq') ? 'FAQ' : k.startsWith('highlight') ? 'Highlight' : k)

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function eventDays(start: string, end: string) {
  if (!start) return []
  const out: string[] = []
  const d = new Date(`${start}T00:00:00`)
  const last = new Date(`${(end && end >= start ? end : start)}T00:00:00`)
  while (d <= last && out.length < 14) {
    const p = (n: number) => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    d.setDate(d.getDate() + 1)
  }
  return out
}

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const next = [...arr]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/* ---------- page ---------- */

export const EventFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { events, isLoading, isError, error, refetch } = useCurrentEvent()
  const isEdit = Boolean(id)
  const event = id ? events.find((e) => e.id === id) : undefined

  const pageQuery = useQuery({
    queryKey: ['eventPage', id],
    queryFn: () => eventPageApi.get(id!),
    enabled: Boolean(id && event),
  })

  const wrap = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>

  if (isEdit) {
    if (isError) return wrap(<ErrorState message={error?.message} onRetry={refetch} />)
    if (pageQuery.isError) return wrap(<ErrorState message={(pageQuery.error as Error).message} onRetry={() => void pageQuery.refetch()} />)
    if (isLoading || (event && pageQuery.isLoading)) {
      return wrap(
        <>
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <Skeleton className="hidden h-96 rounded-2xl lg:block" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </>,
      )
    }
    if (!event) {
      return wrap(
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="We couldn’t find that event"
            description="It may have been deleted, or it belongs to another account."
            action={<ButtonLink to="/app/events">Back to events</ButtonLink>}
          />
        </Card>,
      )
    }
  }

  // Remount when switching between events so the form starts from the right values
  return <EventBuilder key={event?.id ?? 'new'} event={event} page={pageQuery.data} />
}

const EventBuilder: React.FC<{ event?: Event; page?: EventPageContent }> = ({ event, page }) => {
  const eventCategories = useEventCategories()
  const seatsOn = useModuleEnabled('seat_numbers')
  const subEventsOn = useModuleEnabled('sub_events')
  const { events: myEvents } = useCurrentEvent()
  // Main events this one can sit under: the organizer's own top-level events, not itself
  const parentChoices = myEvents.filter((e) => !e.parent && e.id !== event?.id)
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setCurrentEventId } = useCurrentEvent()
  const [params, setParams] = useSearchParams()
  const isEdit = Boolean(event)

  const initial = useMemo(() => (event ? fromEvent(event, page) : emptyDraft), [event, page])
  const initialPage = useMemo(() => pageFromContent(page), [page])
  const [draft, setDraft] = useState<EventDraft>(initial)
  const [content, setContent] = useState<PageDraft>(initialPage)
  const [attempted, setAttempted] = useState<Set<StepId>>(new Set())
  const [maxReached, setMaxReached] = useState(isEdit ? STEPS.length - 1 : 0)
  const [initialSnapshot] = useState(() => JSON.stringify([initial, stripKeys(initialPage)]))
  const dirty = JSON.stringify([draft, stripKeys(content)]) !== initialSnapshot

  const stepParam = params.get('step') as StepId | null
  const requestedIdx = Math.max(0, STEPS.findIndex((s) => s.id === stepParam))
  const requiredValid = REQUIRED.every((s) => Object.keys(validateStep(s, draft, content, !isEdit)).length === 0)
  const canReach = (i: number) => isEdit || i <= maxReached || (requiredValid && maxReached >= 2)
  const stepIdx = canReach(requestedIdx) ? requestedIdx : Math.min(requestedIdx, maxReached)
  const step = STEPS[stepIdx]

  useEffect(() => {
    if (stepParam !== step.id) setParams((p) => (p.set('step', step.id), p), { replace: true })
  }, [stepParam, step.id, setParams])

  const [serverErrors, setServerErrors] = useState<Errors>({})
  const errors: Errors = { ...(attempted.has(step.id) ? validateStep(step.id, draft, content, !isEdit) : {}), ...serverErrors }

  // Focus the step heading after a step change
  const headingRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headingRef.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [stepIdx])

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (serverErrors[key as string]) setServerErrors(({ [key as string]: _, ...rest }) => rest)
  }
  const bind = (key: keyof EventDraft) => ({
    value: draft[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key, e.target.value as never),
    error: errors[key],
  })
  const setPage = <K extends keyof PageDraft>(key: K, value: PageDraft[K]) => setContent((c) => ({ ...c, [key]: value }))

  // Warn before closing the tab with unsaved changes
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const goTo = (i: number) => setParams((p) => (p.set('step', STEPS[i].id), p))

  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('#event-form [aria-invalid="true"]')
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

  const reportErrors = (found: Errors, verb: string) => {
    const keys = Object.keys(found)
    toast.error(keys.length === 1 ? `Fix 1 field ${verb}` : `Fix ${keys.length} fields ${verb}`, [...new Set(keys.map(errorLabel))].join(', '))
  }

  const onContinue = () => {
    const found = validateStep(step.id, draft, content, !isEdit)
    setAttempted((a) => new Set(a).add(step.id))
    if (Object.keys(found).length) {
      reportErrors(found, 'to continue')
      focusFirstError()
      return
    }
    const next = Math.min(stepIdx + 1, STEPS.length - 1)
    setMaxReached((m) => Math.max(m, next))
    goTo(next)
  }

  const save = useMutation({
    mutationFn: async () => {
      const optional = (v: string) => (v ? v : isEdit ? null : undefined)
      const body = {
        title: draft.title.trim(),
        tagline: draft.tagline.trim(),
        category: draft.category,
        description: draft.description.trim(),
        location: draft.location.trim(),
        start_date: draft.start_date,
        start_time: optional(draft.start_time),
        end_date: optional(draft.end_date),
        end_time: optional(draft.end_time),
        capacity: Number(draft.capacity),
        status: draft.status,
        allow_registration: draft.allow_registration,
        show_spots_left: draft.show_spots_left,
        show_managed_by: draft.show_managed_by,
        ticket_layout: draft.ticket_layout,
        show_seat_number: draft.show_seat_number,
        ...(subEventsOn ? { parent: draft.parent || null } : {}),
        managed_by: draft.managed_by.trim(),
        managed_by_logo: draft.managed_by_logo,
        registration_deadline: draft.registration_deadline ? new Date(draft.registration_deadline).toISOString() : isEdit ? null : undefined,
        // On create the server makes a first ticket type from this. After that, prices live on the Tickets page.
        ...(isEdit ? {} : { is_paid: draft.is_paid, ticket_price: draft.is_paid ? Number(draft.ticket_price).toFixed(2) : '0.00' }),
        // Only send the banner when it changed: a new upload path, or '' to remove it
        banner_url: draft.banner === initial.banner ? undefined : (draft.banner ?? ''),
      }
      const saved = event ? await api.updateEvent(event.id, body as unknown as Partial<Event>) : await api.createEvent(body as unknown as Partial<Event>)
      try {
        await eventPageApi.put(saved.id, {
          map_query: draft.map_query.trim(),
          highlights: content.highlights.map((h) => h.text.trim()).filter(Boolean),
          contact_email: content.contact_email.trim(),
          contact_phone: content.contact_phone.trim(),
          terms: content.terms.trim(),
          agenda: content.agenda.map((a) => ({
            day: a.day || null,
            start_time: a.start_time,
            end_time: a.end_time || null,
            title: a.title.trim(),
            location: a.location.trim(),
            speaker_names: a.speaker_names.trim(),
            description: a.description.trim(),
          })),
          speakers: content.speakers.map((s) => ({
            name: s.name.trim(),
            role: s.role.trim(),
            organization: s.organization.trim(),
            photo_url: s.photo_url ?? '',
            bio: s.bio.trim(),
          })),
          faqs: content.faqs.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
        })
      } catch (err) {
        throw Object.assign(new Error((err as Error).message), { savedEvent: saved })
      }
      return saved
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['eventPage', saved.id] })
      queryClient.invalidateQueries({ queryKey: ['publicEvent', saved.slug] })
      setCurrentEventId(saved.id)
      if (isEdit) {
        toast.success('Changes saved', `${saved.title} is up to date on its event page.`)
        navigate('/app/events')
      } else {
        toast.success('Event created', `${saved.title} is now your current event.`)
        navigate('/app')
      }
    },
    onError: (err: Error & { savedEvent?: Event }) => {
      if (err.savedEvent) {
        // The event itself saved; only the page content failed
        queryClient.invalidateQueries({ queryKey: ['events'] })
        toast.error('Event saved, but the event page content didn’t', `${err.message} Fix it and save again.`)
        if (!isEdit) navigate(`/app/events/${err.savedEvent.id}/edit?step=page`)
        return
      }
      // DRF field error ("start_date: ..."): show it on the field and go to its step
      const m = /^([a-z_]+): (.*)$/s.exec(err.message)
      if (m && FIELD_STEP[m[1]]) {
        const key = m[1] === 'banner_url' ? 'banner' : m[1]
        setServerErrors({ [key]: m[2] })
        const idx = STEPS.findIndex((x) => x.id === FIELD_STEP[m[1]])
        if (idx !== stepIdx) goTo(idx)
        toast.error(isEdit ? 'Couldn’t save your changes' : 'Couldn’t create the event', `${errorLabel(key)}: ${m[2]}`)
        return
      }
      toast.error(isEdit ? 'Couldn’t save your changes' : 'Couldn’t create the event', err.message)
    },
  })

  const onSave = (e?: React.FormEvent) => {
    e?.preventDefault()
    // Validate every step; jump to the first one with problems
    const all: [StepId, Errors][] = STEPS.map((s) => [s.id, validateStep(s.id, draft, content, !isEdit)])
    const bad = all.filter(([, errs]) => Object.keys(errs).length)
    if (bad.length) {
      setAttempted((a) => new Set([...a, ...bad.map(([id]) => id)]))
      const [firstId, firstErrs] = bad[0]
      reportErrors(Object.assign({}, ...bad.map(([, er]) => er)), 'before saving')
      const idx = STEPS.findIndex((s) => s.id === firstId)
      setMaxReached((m) => Math.max(m, idx))
      if (firstId !== step.id) goTo(idx)
      void firstErrs
      focusFirstError()
      return
    }
    save.mutate()
  }

  const leave = async (to: string) => {
    if (dirty && !save.isPending) {
      const ok = await toast.confirm({
        title: 'Discard your changes?',
        description: isEdit ? 'Your edits to this event haven’t been saved.' : 'This event hasn’t been created yet. What you’ve typed will be lost.',
        confirmLabel: 'Discard changes',
        danger: true,
      })
      if (!ok) return
    }
    navigate(to)
  }

  const submitLabel = isEdit ? 'Save changes' : 'Create event'
  const statuses = isEdit ? statusOptions : statusOptions.slice(0, 2)
  const days = eventDays(draft.start_date, draft.end_date)
  const stepErrorCount = (id: StepId) => (attempted.has(id) ? Object.keys(validateStep(id, draft, content, !isEdit)).length : 0)
  const isComplete = (id: StepId, i: number) => i < maxReached && Object.keys(validateStep(id, draft, content, !isEdit)).length === 0 && (STEPS[i].required || hasContent(id, draft, content))

  return (
    <div className="w-full space-y-6 px-4 pb-44 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-8 2xl:px-10">
      <div className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-ink-500">
            <li>
              <Link
                to="/app/events"
                onClick={(e) => {
                  e.preventDefault()
                  leave('/app/events')
                }}
                className="font-medium hover:text-ink-900 hover:underline"
              >
                Events
              </Link>
            </li>
            <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
            <li aria-current="page" className="truncate text-ink-700">
              {isEdit ? event!.title : 'New event'}
            </li>
          </ol>
        </nav>
        <PageHeader
          title={isEdit ? 'Edit event' : 'Create event'}
          description={isEdit ? 'Changes show on the public event page as soon as you save.' : 'Fill in the first three steps to create it. The rest can wait.'}
          actions={
            isEdit ? (
              <a
                href={`/e/${event!.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-2 rounded-[10px] border border-ink-200 bg-white px-3 text-[13px] font-semibold text-ink-800 shadow-2xs hover:bg-ink-50"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Preview page
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : undefined
          }
        />
      </div>

      {/* Phones and tablets: compact progress + scrollable step list */}
      <div className="space-y-3 lg:hidden">
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-900">{step.label}</span>
          <span className="text-ink-500">
            Step {stepIdx + 1} of {STEPS.length}
          </span>
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-ink-100"
          role="progressbar"
          aria-label="Event setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((stepIdx + 1) / STEPS.length) * 100)}
        >
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                disabled={!canReach(i)}
                aria-current={i === stepIdx ? 'step' : undefined}
                onClick={() => goTo(i)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:opacity-40',
                  i === stepIdx ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-700',
                )}
              >
                {stepErrorCount(s.id) > 0 ? (
                  <AlertCircle className="h-3.5 w-3.5 text-red-600" aria-label="Has errors" />
                ) : isComplete(s.id, i) ? (
                  <Check className="h-3.5 w-3.5 text-brand-600" aria-label="Done" />
                ) : (
                  <span className="tabular text-ink-400">{i + 1}</span>
                )}
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <form id="event-form" onSubmit={onSave} noValidate className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Desktop step list */}
        <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block">
          <nav aria-label="Event setup steps">
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const errs = stepErrorCount(s.id)
                const done = isComplete(s.id, i)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!canReach(i)}
                      aria-current={i === stepIdx ? 'step' : undefined}
                      onClick={() => goTo(i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        i === stepIdx ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-700 hover:bg-ink-100',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                          errs ? 'border-red-500 bg-red-50 text-red-700' : done ? 'border-brand-600 bg-brand-600 text-white' : i === stepIdx ? 'border-brand-600 bg-white text-brand-700' : 'border-ink-200 bg-white text-ink-500',
                        )}
                      >
                        {errs ? <AlertCircle className="h-3.5 w-3.5" aria-hidden /> : done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        {s.label}
                        {!s.required && s.id !== 'review' && <span className="block text-xs font-normal text-ink-500">Optional</span>}
                      </span>
                      {errs > 0 && <span className="sr-only">{errs} problems</span>}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
          <div className="space-y-2 border-t border-ink-200 pt-4">
            <Button type="submit" className="w-full" loading={save.isPending}>
              {submitLabel}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => leave('/app/events')}>
              Cancel
            </Button>
          </div>
        </aside>

        {/* Current step */}
        <div className="min-w-0">
          <Card>
            <section aria-labelledby="step-heading">
              <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
                <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink-900 outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                  {step.label}
                </h2>
                <p className="mt-0.5 text-sm text-ink-500">{step.description}</p>
              </div>
              <div className="space-y-5 px-5 py-6 sm:px-6">
                {step.id === 'basics' && (
                  <>
                    <Input label="Event name" required placeholder="Koshi Coding Championship 2026" autoFocus={!isEdit} {...bind('title')} />
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px]">
                      <Input label="Tagline" placeholder="One line that sells the event" hint="Optional. Shown under the title." maxLength={160} {...bind('tagline')} />
                      <Select label="Category" {...bind('category')}>
                        {eventCategories.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.name}
                          </option>
                        ))}
                        {/* An event keeps a type the superadmin has since hidden */}
                        {draft.category !== 'other' && !eventCategories.some((c) => c.slug === draft.category) && (
                          <option value={draft.category}>{event?.category_name || draft.category}</option>
                        )}
                        <option value="other">Other</option>
                      </Select>
                    </div>
                    {subEventsOn && parentChoices.length > 0 && (
                      <Select
                        label="Part of"
                        hint="Optional. Make this a sub-event (a session, workshop or screening) of a main event. It keeps its own registration form and tickets."
                        {...bind('parent')}
                      >
                        <option value="">Not part of another event</option>
                        {parentChoices.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.title}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Textarea label="Description" rows={5} placeholder="What the event is about, who it’s for, what to expect" hint="Optional" {...bind('description')} />
                    <ImageUpload
                      label="Banner image"
                      kind="banner"
                      value={draft.banner}
                      onChange={(banner) => setDraft((d) => ({ ...d, banner }))}
                      hint="Shown at the top of the event page. A wide image (about 1600 × 700) works best. JPG, PNG or WebP, up to 5 MB."
                    />
                  </>
                )}

                {step.id === 'when' && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input label="Start date" type="date" required min={isEdit ? undefined : localToday()} {...bind('start_date')} />
                      <Input label="Start time" type="time" hint="Optional" {...bind('start_time')} />
                      <Input label="End date" type="date" min={draft.start_date || undefined} hint="Optional" {...bind('end_date')} />
                      <Input label="End time" type="time" hint="Optional" {...bind('end_time')} />
                    </div>
                    <Input label="Venue" required placeholder="Itahari City Hall, Sunsari" hint="Venue name and town, as attendees would search for it" {...bind('location')} />
                    <Input
                      label="Map search"
                      placeholder={draft.location || 'e.g. Purwanchal Campus, Dharan, Nepal'}
                      hint="Optional. What to search on the map if the venue name alone doesn’t find it."
                      {...bind('map_query')}
                    />
                  </>
                )}

                {step.id === 'registration' && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input label="Capacity" type="number" inputMode="numeric" min={1} required hint="Registration closes when this many people sign up" {...bind('capacity')} />
                      <Select label="Status" hint="Only published events accept registrations" {...bind('status')}>
                        {statuses.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Select
                      label="Ticket layout"
                      hint="Shape of the pass people download, print and see in the app."
                      value={draft.ticket_layout}
                      onChange={(e) => set('ticket_layout', e.target.value as EventDraft['ticket_layout'])}
                    >
                      <option value="vertical">Vertical (phone screen)</option>
                      <option value="landscape">Landscape (wide)</option>
                    </Select>
                    {seatsOn && (
                      <Checkbox
                        label="Show seat numbers to attendees"
                        hint="Assign seats from the attendee list on the dashboard. Gate staff always see them."
                        checked={draft.show_seat_number}
                        onChange={(v) => set('show_seat_number', v)}
                      />
                    )}
                    <Checkbox
                      label="Show how many spots are left"
                      hint="Attendees still see Fully booked / Sold out."
                      checked={draft.show_spots_left}
                      onChange={(v) => set('show_spots_left', v)}
                    />
                    <Checkbox
                      label="Accept registrations"
                      hint="Turn off to close sign-ups without unpublishing the event."
                      checked={draft.allow_registration}
                      onChange={(v) => set('allow_registration', v)}
                    />
                    {draft.allow_registration && (
                      <Input label="Registration deadline" type="datetime-local" hint="Optional. Sign-ups close at this time." {...bind('registration_deadline')} />
                    )}
                    {isEdit ? (
                      <TicketsNote eventId={event!.id} />
                    ) : (
                      <>
                        <Checkbox
                          label="Paid tickets"
                          hint="Attendees pay at the venue. There’s no online payment yet. Add student, VIP or early-bird prices on the Tickets page after you create the event."
                          checked={draft.is_paid}
                          onChange={(v) => set('is_paid', v)}
                        />
                        {draft.is_paid && (
                          <Input label="Ticket price (Rs)" type="number" inputMode="decimal" min={1} step="any" required placeholder="500" containerClassName="sm:max-w-xs" {...bind('ticket_price')} />
                        )}
                      </>
                    )}
                  </>
                )}

                {step.id === 'page' && (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-ink-800">Highlights</p>
                      <p className="text-xs text-ink-500">Short reasons to come, shown as a checklist. Up to 12.</p>
                      {content.highlights.length === 0 && <p className="rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm text-ink-500">No highlights yet.</p>}
                      <ul className="space-y-2">
                        {content.highlights.map((h, i) => (
                          <li key={h.key} className="flex items-start gap-1">
                            <Input
                              label={`Highlight ${i + 1}`}
                              containerClassName="min-w-0 flex-1 [&_label]:sr-only"
                              value={h.text}
                              maxLength={120}
                              placeholder="e.g. Free lunch and T-shirt"
                              error={errors[`highlight.${h.key}`]}
                              onChange={(e) => setPage('highlights', content.highlights.map((x) => (x.key === h.key ? { ...x, text: e.target.value } : x)))}
                            />
                            <RowControls
                              label={`highlight ${i + 1}`}
                              index={i}
                              count={content.highlights.length}
                              onMove={(dir) => setPage('highlights', move(content.highlights, i, dir))}
                              onRemove={() => setPage('highlights', content.highlights.filter((x) => x.key !== h.key))}
                            />
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={content.highlights.length >= 12}
                        icon={<Plus className="h-4 w-4" aria-hidden />}
                        onClick={() => setPage('highlights', [...content.highlights, { key: newKey(), text: '' }])}
                      >
                        Add highlight
                      </Button>
                    </div>
                    <div className="grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-2">
                      <Input
                        label="Contact email"
                        type="email"
                        hint="Optional. Shown on the event page."
                        value={content.contact_email}
                        error={errors.contact_email}
                        onChange={(e) => setPage('contact_email', e.target.value)}
                      />
                      <Input label="Contact phone" type="tel" hint="Optional" value={content.contact_phone} onChange={(e) => setPage('contact_phone', e.target.value)} />
                    </div>
                    <div className="space-y-4 border-t border-ink-100 pt-5">
                      <Checkbox
                        label="Show “Managed by”"
                        hint="Credit the agency or team running the event, next to your organization’s name."
                        checked={draft.show_managed_by}
                        onChange={(v) => set('show_managed_by', v)}
                      />
                      {draft.show_managed_by && (
                        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                          <Input label="Managed by" required placeholder="Eastern Events Pvt. Ltd." {...bind('managed_by')} />
                          <ImageUpload label="Logo" kind="logo" shape="square" hint="Optional" value={draft.managed_by_logo || null} onChange={(url) => set('managed_by_logo', url ?? '')} />
                        </div>
                      )}
                    </div>
                  </>
                )}

                {step.id === 'schedule' && (
                  <RepeatList
                    items={content.agenda}
                    empty="No schedule yet. Add the first item, for example Registration at 9:00."
                    addLabel="Add schedule item"
                    onAdd={() =>
                      setPage('agenda', [
                        ...content.agenda,
                        { key: newKey(), day: days[0] ?? '', start_time: '', end_time: '', title: '', location: '', speaker_names: '', description: '' },
                      ])
                    }
                    onChange={(items) => setPage('agenda', items)}
                    title={(a, i) => a.title.trim() || `Item ${i + 1}`}
                    render={(a, update) => (
                      <div className="grid gap-4 sm:grid-cols-3">
                        {days.length > 1 ? (
                          <Select label="Day" value={a.day} onChange={(e) => update({ day: e.target.value })}>
                            {days.map((d, i) => (
                              <option key={d} value={d}>
                                Day {i + 1}, {fmtDate(d)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input label="Day" type="date" value={a.day} hint="Optional" onChange={(e) => update({ day: e.target.value })} />
                        )}
                        <Input label="Starts" type="time" required value={a.start_time} error={errors[`agenda.${a.key}.start_time`]} onChange={(e) => update({ start_time: e.target.value })} />
                        <Input label="Ends" type="time" hint="Optional" value={a.end_time} error={errors[`agenda.${a.key}.end_time`]} onChange={(e) => update({ end_time: e.target.value })} />
                        <Input
                          label="Title"
                          required
                          containerClassName="sm:col-span-3"
                          value={a.title}
                          placeholder="Opening keynote"
                          error={errors[`agenda.${a.key}.title`]}
                          onChange={(e) => update({ title: e.target.value })}
                        />
                        <Input label="Stage or room" containerClassName="sm:col-span-1" value={a.location} placeholder="Main hall" onChange={(e) => update({ location: e.target.value })} />
                        <Input label="Speakers" containerClassName="sm:col-span-2" value={a.speaker_names} placeholder="Names, separated by commas" onChange={(e) => update({ speaker_names: e.target.value })} />
                        <Textarea label="Description" rows={2} containerClassName="sm:col-span-3" hint="Optional" value={a.description} onChange={(e) => update({ description: e.target.value })} />
                      </div>
                    )}
                  />
                )}

                {step.id === 'speakers' && (
                  <RepeatList
                    items={content.speakers}
                    empty="No speakers yet. Add speakers, performers or chief guests."
                    addLabel="Add speaker"
                    onAdd={() => setPage('speakers', [...content.speakers, { key: newKey(), name: '', role: '', organization: '', photo_url: null, bio: '' }])}
                    onChange={(items) => setPage('speakers', items)}
                    title={(s, i) => s.name.trim() || `Speaker ${i + 1}`}
                    render={(s, update) => (
                      <div className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
                        <ImageUpload label="Photo" kind="avatar" shape="square" value={s.photo_url} onChange={(url) => update({ photo_url: url })} hint="Optional. Square works best." />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Input label="Name" required containerClassName="sm:col-span-2" value={s.name} error={errors[`speaker.${s.key}.name`]} onChange={(e) => update({ name: e.target.value })} />
                          <Input label="Role" placeholder="Founder and CEO" value={s.role} onChange={(e) => update({ role: e.target.value })} />
                          <Input label="Organization" placeholder="Koshi Cloud" value={s.organization} onChange={(e) => update({ organization: e.target.value })} />
                          <Textarea label="Bio" rows={3} containerClassName="sm:col-span-2" hint="Optional. Two or three sentences." value={s.bio} onChange={(e) => update({ bio: e.target.value })} />
                        </div>
                      </div>
                    )}
                  />
                )}

                {step.id === 'faqs' && (
                  <RepeatList
                    items={content.faqs}
                    empty="No questions yet. Think parking, food, age limits, what to bring."
                    addLabel="Add question"
                    onAdd={() => setPage('faqs', [...content.faqs, { key: newKey(), question: '', answer: '' }])}
                    onChange={(items) => setPage('faqs', items)}
                    title={(f, i) => f.question.trim() || `Question ${i + 1}`}
                    render={(f, update) => (
                      <div className="space-y-4">
                        <Input label="Question" required value={f.question} error={errors[`faq.${f.key}.question`]} onChange={(e) => update({ question: e.target.value })} />
                        <Textarea label="Answer" required rows={3} value={f.answer} error={errors[`faq.${f.key}.answer`]} onChange={(e) => update({ answer: e.target.value })} />
                      </div>
                    )}
                  />
                )}
                {step.id === 'faqs' && (
                  <Textarea
                    label="Terms & conditions"
                    rows={6}
                    maxLength={10000}
                    className="mt-6"
                    placeholder="Refund policy, entry rules, age limits, photography consent…"
                    hint="Optional. Shown exactly as written in a Terms & conditions section on the event page."
                    value={content.terms}
                    onChange={(e) => setPage('terms', e.target.value)}
                  />
                )}

                {step.id === 'review' && <Review draft={draft} content={content} event={event} onEdit={(id) => goTo(STEPS.findIndex((s) => s.id === id))} />}
              </div>

              {/* Desktop step footer */}
              <div className="hidden items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 sm:px-6 lg:flex">
                {stepIdx > 0 ? (
                  <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} onClick={() => goTo(stepIdx - 1)}>
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                {step.id === 'review' ? (
                  <Button type="submit" size="lg" loading={save.isPending}>
                    {submitLabel}
                  </Button>
                ) : (
                  <Button variant={step.required ? 'primary' : 'secondary'} onClick={onContinue}>
                    {step.required ? 'Continue' : hasContent(step.id, draft, content) ? 'Continue' : 'Skip for now'}
                  </Button>
                )}
              </div>
            </section>
          </Card>
        </div>

        <aside className="hidden xl:sticky xl:top-20 xl:block">
          <Summary draft={draft} content={content} event={event} />
        </aside>
      </form>

      {isEdit && <DangerZone event={event!} />}

      {/* Phone/tablet: actions stay reachable, docked just above the app's bottom tab bar (which owns the safe-area inset) */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl gap-2 px-4 py-3 sm:px-6">
          {stepIdx > 0 && (
            <IconButton label="Previous step" onClick={() => goTo(stepIdx - 1)} className="h-10 w-10 shrink-0 border border-ink-200 bg-white">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </IconButton>
          )}
          {step.id !== 'review' && (
            <Button variant="secondary" className="flex-1" onClick={onContinue}>
              {step.required || hasContent(step.id, draft, content) ? 'Continue' : 'Skip'}
            </Button>
          )}
          <Button type="submit" form="event-form" className="flex-1" loading={save.isPending}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function stripKeys(p: PageDraft) {
  const strip = <T extends Row>(rows: T[]) => rows.map(({ key: _k, ...rest }) => rest)
  return { ...p, highlights: strip(p.highlights), agenda: strip(p.agenda), speakers: strip(p.speakers), faqs: strip(p.faqs) }
}

function hasContent(id: StepId, d: EventDraft, p: PageDraft) {
  if (id === 'page') return p.highlights.length > 0 || Boolean(p.contact_email || p.contact_phone)
  if (id === 'schedule') return p.agenda.length > 0
  if (id === 'speakers') return p.speakers.length > 0
  if (id === 'faqs') return p.faqs.length > 0 || Boolean(p.terms.trim())
  return Boolean(d)
}

/* ------------------------------------------------------------------ */

const RowControls: React.FC<{ label: string; index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove: () => void }> = ({
  label,
  index,
  count,
  onMove,
  onRemove,
}) => (
  <div className="flex shrink-0 items-center">
    <IconButton label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)} className="disabled:opacity-30">
      <ArrowUp className="h-4 w-4" aria-hidden />
    </IconButton>
    <IconButton label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)} className="disabled:opacity-30">
      <ArrowDown className="h-4 w-4" aria-hidden />
    </IconButton>
    <IconButton label={`Remove ${label}`} onClick={onRemove} className="hover:bg-red-50 hover:text-red-700">
      <Trash2 className="h-4 w-4" aria-hidden />
    </IconButton>
  </div>
)

function RepeatList<T extends Row>({
  items,
  empty,
  addLabel,
  onAdd,
  onChange,
  title,
  render,
}: {
  items: T[]
  empty: string
  addLabel: string
  onAdd: () => void
  onChange: (items: T[]) => void
  title: (item: T, i: number) => string
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode
}) {
  return (
    <div className="space-y-4">
      {items.length === 0 && <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500">{empty}</p>}
      <ol className="space-y-4">
        {items.map((item, i) => (
          <li key={item.key} className="rounded-xl border border-ink-200">
            <div className="flex items-center justify-between gap-2 border-b border-ink-100 bg-ink-50/60 py-1.5 pl-4 pr-1.5">
              <p className="min-w-0 truncate text-sm font-semibold text-ink-900">
                <span className="mr-2 text-ink-400 tabular">{i + 1}.</span>
                {title(item, i)}
              </p>
              <RowControls
                label={title(item, i)}
                index={i}
                count={items.length}
                onMove={(dir) => onChange(move(items, i, dir))}
                onRemove={() => onChange(items.filter((x) => x.key !== item.key))}
              />
            </div>
            <div className="p-4">{render(item, (patch) => onChange(items.map((x) => (x.key === item.key ? { ...x, ...patch } : x))))}</div>
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  )
}

const Checkbox: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, hint, checked, onChange }) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 hover:bg-ink-50">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
    />
    <span>
      <span className="block text-sm font-medium text-ink-900">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
    </span>
  </label>
)

const whenText = (d: EventDraft) =>
  d.start_date
    ? `${fmtDate(d.start_date)}${d.start_time ? `, ${fmtClock(d.start_time)}` : ''}${d.end_date && d.end_date !== d.start_date ? ` to ${fmtDate(d.end_date)}` : ''}`
    : 'Date not set'

const Review: React.FC<{ draft: EventDraft; content: PageDraft; event?: Event; onEdit: (id: StepId) => void }> = ({ draft, content, event, onEdit }) => {
  const ticketSummary = useTicketSummary(event?.id)
  const categoryName = useEventCategories().find((c) => c.slug === draft.category)?.name ?? event?.category_name
  const groups: { id: StepId; rows: [string, string][] }[] = [
    {
      id: 'basics',
      rows: [
        ['Name', draft.title.trim() || 'Not set'],
        ['Tagline', draft.tagline.trim() || 'None'],
        ['Category', draft.category === 'other' ? 'Other' : (categoryName ?? draft.category)],
        ['Banner', draft.banner ? 'Uploaded' : 'None (a brand pattern is shown)'],
      ],
    },
    {
      id: 'when',
      rows: [
        ['When', whenText(draft)],
        ['Venue', draft.location.trim() || 'Not set'],
        ['Map search', draft.map_query.trim() || 'Same as venue'],
      ],
    },
    {
      id: 'registration',
      rows: [
        ['Capacity', draft.capacity ? `${draft.capacity} people` : 'Not set'],
        ['Status', statusOptions.find((s) => s.value === draft.status)?.label ?? draft.status],
        ['Registration', draft.allow_registration ? (draft.registration_deadline ? `Open until ${new Date(draft.registration_deadline).toLocaleString()}` : 'Open') : 'Closed'],
        ['Price', event ? ticketSummary ?? 'Set on the Tickets page' : draft.is_paid ? `Rs ${draft.ticket_price || '?'}, paid at the venue` : 'Free'],
      ],
    },
    {
      id: 'page',
      rows: [
        ['Highlights', content.highlights.filter((h) => h.text.trim()).length ? `${content.highlights.filter((h) => h.text.trim()).length} highlights` : 'None'],
        ['Contact', [content.contact_email, content.contact_phone].filter(Boolean).join(', ') || 'None'],
      ],
    },
    { id: 'schedule', rows: [['Schedule', content.agenda.length ? `${content.agenda.length} items` : 'Not added']] },
    { id: 'speakers', rows: [['Speakers', content.speakers.length ? content.speakers.map((s) => s.name || 'Unnamed').join(', ') : 'Not added']] },
    { id: 'faqs', rows: [['FAQs', content.faqs.length ? `${content.faqs.length} questions` : 'Not added'], ['Terms & conditions', content.terms.trim() ? 'Added' : 'Not added']] },
  ]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.id} className="rounded-xl border border-ink-200">
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-900">{STEPS.find((s) => s.id === g.id)!.label}</h3>
            <button type="button" onClick={() => onEdit(g.id)} className="text-sm font-medium text-brand-700 hover:underline">
              Edit<span className="sr-only"> {STEPS.find((s) => s.id === g.id)!.label}</span>
            </button>
          </div>
          <dl className="divide-y divide-ink-100">
            {g.rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-ink-500">{label}</dt>
                <dd className={cn('break-words', /^(None|Not set|Not added)/.test(value) ? 'text-ink-400' : 'font-medium text-ink-900')}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {event ? (
        <p className="text-sm text-ink-500">
          <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
            Preview the event page
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>{' '}
          Save first to see your latest changes there.
        </p>
      ) : (
        <p className="text-sm text-ink-500">You’ll get the event page link as soon as the event is created.</p>
      )}
    </div>
  )
}

const Summary: React.FC<{ draft: EventDraft; content: PageDraft; event?: Event }> = ({ draft, content, event }) => {
  const cap = Number(draft.capacity)
  const ticketSummary = useTicketSummary(event?.id)
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-ink-500">Summary</p>
      <p className="mt-1 break-words font-display text-lg font-bold text-ink-900">{draft.title.trim() || 'Untitled event'}</p>
      {draft.tagline.trim() && <p className="mt-0.5 text-sm text-ink-600">{draft.tagline.trim()}</p>}
      <ul className="mt-3 space-y-2 text-sm text-ink-600">
        <li className="flex gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          {whenText(draft)}
        </li>
        <li className="flex gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          <span className="break-words">{draft.location.trim() || 'Venue not set'}</span>
        </li>
        <li className="flex gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          {cap > 0 ? `Up to ${cap} people` : 'Capacity not set'}
        </li>
        <li className="flex gap-2">
          <TicketIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          {event
            ? (ticketSummary ?? 'Tickets')
            : draft.is_paid
              ? Number(draft.ticket_price) > 0
                ? `Rs ${Number(draft.ticket_price)} per ticket`
                : 'Paid, price not set'
              : 'Free'}
          {!draft.allow_registration && ', registration closed'}
        </li>
        {event && (
          <li className="flex gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span className="break-all font-mono text-xs leading-5">/e/{event.slug}</span>
          </li>
        )}
      </ul>
      <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
        Event page: {content.agenda.length} schedule items, {content.speakers.length} speakers, {content.faqs.length} FAQs
      </p>
      {draft.status !== 'published' && (
        <p className="mt-3 rounded-lg bg-marigold-50 px-3 py-2 text-xs text-marigold-900">Attendees can only register once the status is Published.</p>
      )}
    </Card>
  )
}

/* ---------- tickets (edit mode) ---------- */

/** "General, Rs 500" or "3 ticket types, From Rs 250" for an existing event. */
function useTicketSummary(eventId?: string) {
  const { data } = useQuery({ queryKey: ticketKeys.types(eventId ?? ''), queryFn: () => ticketsApi.list(eventId!), enabled: Boolean(eventId) })
  if (!data) return null
  const active = data.filter((t) => t.is_active)
  if (!active.length) return 'No ticket types on sale'
  if (active.length === 1) return `${active[0].name}, ${priceText(active[0].price)}`
  return `${active.length} ticket types, ${eventPriceLabel(active, { is_paid: false, ticket_price: '0' })}`
}

const TicketsNote: React.FC<{ eventId: string }> = ({ eventId }) => {
  const { data, isLoading } = useQuery({ queryKey: ticketKeys.types(eventId), queryFn: () => ticketsApi.list(eventId) })
  const active = (data ?? []).filter((t) => t.is_active)
  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-ink-800">
            <TicketIcon className="h-4 w-4 text-ink-400" aria-hidden />
            Tickets and prices
          </p>
          <p className="mt-0.5 text-xs text-ink-500">Set up General, Student, VIP or early-bird tickets and promo codes on the Tickets page. Attendees pay at the venue.</p>
        </div>
        <Link to={`/app/tickets?event=${eventId}`} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          Set up tickets
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {isLoading ? (
        <Skeleton className="mt-3 h-6 w-48" />
      ) : active.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {active.map((t) => (
            <li key={t.id} className="rounded-lg bg-ink-50 px-2.5 py-1 text-xs text-ink-700">
              <span className="font-medium text-ink-900">{t.name}</span> · {priceText(t.price)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-marigold-800">No ticket types are on sale, so nobody can register yet.</p>
      )}
    </div>
  )
}

/* ---------- cancel / delete (edit mode) ---------- */

const DangerZone: React.FC<{ event: Event }> = ({ event }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const cancelled = eventPhase(event) === 'cancelled'
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['events'] })
    void queryClient.invalidateQueries({ queryKey: ['publicEvent', event.slug] })
  }

  const cancel = useMutation({
    mutationFn: () => api.updateEvent(event.id, { status: 'cancelled' }),
    onSuccess: () => {
      refresh()
      toast.success(`${event.title} cancelled`, 'Its page now says it was cancelled, registration is closed and gates refuse its passes.')
      navigate('/app/events')
    },
    onError: (e: Error) => toast.error('Couldn’t cancel the event', e.message),
  })

  const remove = useMutation({
    mutationFn: () => request<unknown>(`/events/${event.id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh()
      toast.success(`${event.title} deleted`)
      navigate('/app/events')
    },
    onError: async (e: Error) => {
      // Events with registrations can't be deleted: offer to cancel instead
      const ok = await toast.confirm({
        title: 'This event can’t be deleted',
        description: cancelled ? e.message : `${e.message.replace(/\s*$/, '')} Cancelling keeps attendee records and tells visitors the event is off.`,
        confirmLabel: cancelled ? 'OK' : 'Cancel event instead',
        danger: !cancelled,
      })
      if (ok && !cancelled) cancel.mutate()
    },
  })

  const confirmCancel = async () => {
    const ok = await toast.confirm({
      title: `Cancel ${event.title}?`,
      description: `Registration closes, the event page says it was cancelled, and gates refuse its passes. ${event.registered_count ? `${event.registered_count} registered attendees keep their records.` : ''}`,
      confirmLabel: 'Cancel event',
      danger: true,
    })
    if (ok) cancel.mutate()
  }

  const confirmDelete = async () => {
    const ok = await toast.confirm({
      title: `Delete ${event.title}?`,
      description: event.registered_count
        ? `${event.registered_count} people registered, so it probably can’t be deleted. Cancel it instead to keep their records.`
        : 'The event, its page and its settings are removed. This can’t be undone.',
      confirmLabel: 'Delete event',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  return (
    <Card className="mt-6 border-red-200">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink-900">Cancel or delete this event</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {cancelled
              ? 'This event is cancelled. To reopen it, set the status back to Published above and save.'
              : 'Cancel if it isn’t happening: attendees see that it’s off and their records are kept. Delete only works for events nobody registered for.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!cancelled && (
            <Button variant="secondary" loading={cancel.isPending} onClick={confirmCancel} icon={<Ban className="h-4 w-4" aria-hidden />}>
              Cancel event
            </Button>
          )}
          <Button variant="ghost" loading={remove.isPending} onClick={confirmDelete} className="text-red-700 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" aria-hidden />}>
            Delete event
          </Button>
        </div>
      </div>
    </Card>
  )
}
