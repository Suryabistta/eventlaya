/** The "Form" step of the event form: pick the questions people answer (a template, a copy of one of your forms,
 *  or name / email / phone only) while creating the event. Editing questions stays on Dynamic forms. */
import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, FileText, LayoutTemplate } from 'lucide-react'
import { api, request, type DynamicForm, type Event, type EventKind } from '@/services/api'
import { FORM_TEMPLATES, createFormFromTemplate, type TemplateField } from '@/lib/form-templates'
import { Card } from '@/components/ui'
import { cn } from '@/lib/utils'

/** '' = name, email and phone only · 'tpl:<template id>' · 'copy:<form id>' */
export type FormChoice = string
export type FormRole = 'registration' | 'application'

/** Templates that fit each kind come first */
const FIRST: Record<EventKind, string[]> = {
  ticketing: ['concert', 'conference', 'running'],
  registration: ['registration', 'conference', 'hackathon', 'volunteer'],
  pageant: ['pageant', 'film'],
}

export const DEFAULT_CHOICE: Record<EventKind, FormChoice> = { ticketing: '', registration: 'tpl:registration', pageant: 'tpl:pageant' }

/** Creates and links the chosen form on a just-created event. Errors bubble up to the caller. */
export async function applyFormChoice(event: Pick<Event, 'id' | 'title'>, choice: FormChoice, as: FormRole) {
  if (choice.startsWith('tpl:')) {
    const t = FORM_TEMPLATES.find((x) => x.id === choice.slice(4))
    if (t) await createFormFromTemplate(event, t, as)
  } else if (choice.startsWith('copy:')) {
    await request<DynamicForm>(`/forms/${choice.slice(5)}/duplicate/`, { method: 'POST', body: JSON.stringify({ event: event.id, link: as }) })
  } else if (as === 'application') {
    // Applications only open with a published application form, so "name, email and phone only" still gets one (empty)
    const slug = `${event.title}-application`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'application'
    const form = await api.createForm({ title: `Apply to ${event.title}`, slug, event: event.id, status: 'published' })
    await api.updateEvent(event.id, { application_form: form.id })
  }
}

type Option = { value: FormChoice; title: string; text: string; icon: React.ReactNode; fields: Pick<TemplateField, 'label' | 'field_type' | 'required'>[] }

export const FormChoicePicker: React.FC<{
  kind: EventKind
  role: FormRole
  value: FormChoice
  onChange: (v: FormChoice) => void
  label: string
}> = ({ kind, role, value, onChange, label }) => {
  const { data: forms = [] } = useQuery({ queryKey: ['forms'], queryFn: api.getForms })
  const mine = forms.filter((f) => f.fields.length > 0 && f.status !== 'archived')

  const { suggested, more } = useMemo(() => {
    const tpl = (id: string): Option | null => {
      const t = FORM_TEMPLATES.find((x) => x.id === id)
      return t ? { value: `tpl:${t.id}`, title: t.name, text: t.description, icon: <LayoutTemplate className="h-4 w-4" />, fields: t.fields } : null
    }
    const first = FIRST[kind].map(tpl).filter(Boolean) as Option[]
    const rest = FORM_TEMPLATES.filter((t) => !FIRST[kind].includes(t.id)).map((t) => tpl(t.id)!)
    return { suggested: first, more: rest }
  }, [kind])

  const basic: Option = { value: '', title: 'Name, email and phone only', text: 'No extra questions. You can add some later.', icon: <FileText className="h-4 w-4" />, fields: [] }
  const copies: Option[] = mine.map((f) => ({
    value: `copy:${f.id}`, title: f.title, text: `${f.fields.length} questions${f.is_template ? ' · saved template' : ''}`, icon: <Copy className="h-4 w-4" />, fields: f.fields,
  }))
  const all = [...suggested, basic, ...copies, ...more]
  const picked = all.find((o) => o.value === value) ?? basic

  const Tile = (o: Option) => (
    <button key={o.value || 'basic'} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
      className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
        value === o.value ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-ink-200 bg-white hover:border-ink-300')}>
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', value === o.value ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600')} aria-hidden>
        {value === o.value ? <Check className="h-4 w-4" /> : o.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{o.title}</span>
        <span className="block text-xs text-ink-500">{o.text}</span>
      </span>
    </button>
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4" role="radiogroup" aria-label={label}>
        <Group title="Suggested">{[...suggested, basic].map(Tile)}</Group>
        {copies.length > 0 && <Group title="Copy from one of my forms">{copies.map(Tile)}</Group>}
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">More templates ({more.length})</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{more.map(Tile)}</div>
        </details>
      </div>
      <Card className="h-fit p-4 lg:sticky lg:top-20">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{role === 'application' ? 'Applicants answer' : 'People answer'}</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {['Full name', 'Email', 'Phone number'].map((l) => <li key={l} className="text-ink-500">{l} <span className="text-xs">(always)</span></li>)}
          {picked.fields.filter((f) => f.field_type !== 'heading').map((f, i) => (
            <li key={i} className="text-ink-900">{f.label}{f.required && <span className="text-red-600"> *</span>}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-500">You can change any question in Dynamic forms after creating the event.</p>
      </Card>
    </div>
  )
}

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</p>
    <div className="grid gap-2 sm:grid-cols-2">{children}</div>
  </div>
)

/** Editing an event: which forms are linked, with a way to edit them. */
export const LinkedFormsSummary: React.FC<{ event: Event }> = ({ event }) => {
  const { data: forms = [] } = useQuery({ queryKey: ['forms'], queryFn: api.getForms })
  const rows = [
    event.tickets_enabled !== false && { role: event.registration_mode === 'form' ? 'Sign-up form' : 'Buyer questions', form: forms.find((f) => f.id === event.registration_form) },
    event.applications_enabled && { role: 'Application form', form: forms.find((f) => f.id === event.application_form) },
  ].filter(Boolean) as { role: string; form?: DynamicForm }[]
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.role} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 p-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">{r.role}</p>
            <p className="text-xs text-ink-500">{r.form ? `${r.form.title} · ${r.form.fields.length} questions` : 'Name, email and phone only'}</p>
          </div>
          <Link to="/app/forms" className="text-sm font-semibold text-brand-700 hover:underline">Edit in Dynamic forms</Link>
        </li>
      ))}
    </ul>
  )
}
