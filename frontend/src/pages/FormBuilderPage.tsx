import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarDays, Eye, FileText, Lock, Pencil, Plus, Ticket as TicketIcon, Trash2 } from 'lucide-react'
import { api, request, type DynamicForm, type Event, type FormField } from '@/services/api'
import { useCurrentEvent } from '@/lib/event-context'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// The shared API client only exposes create calls for forms; the backend viewsets also accept PATCH/DELETE.
const formsApi = {
  updateForm: (id: string, body: Partial<DynamicForm>) =>
    request<DynamicForm>(`/forms/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateField: (id: string, body: Partial<FormField>) =>
    request<FormField>(`/forms/fields/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteField: (id: string) => request<null>(`/forms/fields/${id}/`, { method: 'DELETE' }),
}

type FieldType = FormField['field_type']

const fieldTypes: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Short answer' },
  { value: 'paragraph', label: 'Long answer' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone number' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Single choice' },
  { value: 'checkbox', label: 'Checkboxes' },
]
const typeLabel = (t: FieldType) => fieldTypes.find((f) => f.value === t)?.label ?? t
const hasOptions = (t: FieldType) => t === 'select' || t === 'radio' || t === 'checkbox'
const hasPlaceholder = (t: FieldType) => !hasOptions(t) && t !== 'date'

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'form'

export const FormBuilderPage: React.FC = () => {
  const { currentEvent, isLoading: eventsLoading, isError: eventsError, error: eventsErr, refetch: refetchEvents } = useCurrentEvent()
  const { data: forms = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['forms'], queryFn: api.getForms })

  // The event's registration form is the one linked on the event; fall back to a form created for this event.
  const form = useMemo(() => {
    if (!currentEvent) return undefined
    return forms.find((f) => f.id === currentEvent.registration_form) ?? forms.find((f) => f.event === currentEvent.id)
  }, [forms, currentEvent])

  const wrap = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>

  if (eventsError) return wrap(<ErrorState message={eventsErr?.message} onRetry={refetchEvents} />)
  if (!eventsLoading && !currentEvent) {
    return wrap(
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="Create an event first"
          description="Registration forms belong to an event. Create one, then add the questions attendees answer when they sign up."
          action={<ButtonLink to="/app/events">Go to events</ButtonLink>}
        />
      </Card>,
    )
  }

  return wrap(
    <>
      <PageHeader
        title="Registration form"
        description={
          currentEvent
            ? `Questions attendees answer when they register for ${currentEvent.title}. Name, email and phone are always asked.`
            : 'Questions attendees answer when they register.'
        }
      />
      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : eventsLoading || isLoading ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : !form ? (
        <NoForm event={currentEvent!} />
      ) : (
        <Builder key={form.id} form={form} event={currentEvent!} />
      )}
    </>,
  )
}

const NoForm: React.FC<{ event: Event }> = ({ event }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () => {
      const form = await api.createForm({
        title: `${event.title} registration`,
        slug: slugify(`${event.title}-registration`),
        event: event.id,
        status: 'published',
      })
      // Link it so the public registration page shows these questions
      await api.updateEvent(event.id, { registration_form: form.id })
      return form
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Registration form created', 'Add the questions you want attendees to answer.')
    },
    onError: (err: Error) => toast.error('Couldn’t create the form', err.message),
  })

  return (
    <Card>
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title="No registration form yet"
        description="Right now attendees only give their name, email and phone. Add a form to ask for things like college, T-shirt size or meal choice."
        action={
          <Button icon={<Plus className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>
            Create registration form
          </Button>
        }
      />
    </Card>
  )
}

interface FieldDraft {
  label: string
  field_type: FieldType
  placeholder: string
  help_text: string
  required: boolean
  options: string
}

const blankDraft: FieldDraft = { label: '', field_type: 'text', placeholder: '', help_text: '', required: false, options: '' }

const toDraft = (f: FormField): FieldDraft => ({
  label: f.label,
  field_type: f.field_type,
  placeholder: f.placeholder ?? '',
  help_text: f.help_text ?? '',
  required: f.required,
  options: (f.options ?? []).join('\n'),
})

const parseOptions = (s: string) =>
  s
    .split(/\n|,/)
    .map((o) => o.trim())
    .filter(Boolean)

const Builder: React.FC<{ form: DynamicForm; event: Event }> = ({ form, event }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const fields = useMemo(() => [...(form.fields ?? [])].sort((a, b) => a.order - b.order), [form.fields])
  // null = nothing selected, 'new' = adding a question, otherwise the field id being edited
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<FieldDraft>(blankDraft)
  const [busy, setBusy] = useState(false)

  const editingField = fields.find((f) => f.id === editing)
  const isLinked = event.registration_form === form.id

  useEffect(() => {
    if (editing === 'new') setDraft(blankDraft)
    else if (editingField) setDraft(toDraft(editingField))
    // Only reset the draft when switching which question is being edited
  }, [editing])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['forms'] })

  const saveField = useMutation({
    mutationFn: async (d: FieldDraft) => {
      const body: Partial<FormField> = {
        label: d.label.trim(),
        field_type: d.field_type,
        placeholder: hasPlaceholder(d.field_type) ? d.placeholder.trim() : '',
        help_text: d.help_text.trim(),
        required: d.required,
        options: hasOptions(d.field_type) ? parseOptions(d.options) : [],
      }
      if (editing === 'new') {
        const maxOrder = fields.reduce((m, f) => Math.max(m, f.order), 0)
        return api.createFormField({ ...body, form: form.id, order: maxOrder + 1 } as Partial<FormField>)
      }
      return formsApi.updateField(editing!, body)
    },
    onSuccess: (saved) => {
      toast.success(editing === 'new' ? 'Question added' : 'Changes saved')
      refresh()
      setEditing(saved.id ?? null)
    },
    onError: (err: Error) => toast.error('Couldn’t save the question', err.message),
  })

  const updateFormStatus = useMutation({
    mutationFn: async (status: DynamicForm['status']) => {
      await formsApi.updateForm(form.id, { status })
      if (status === 'published' && !isLinked) await api.updateEvent(event.id, { registration_form: form.id })
    },
    onSuccess: (_, status) => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success(status === 'published' ? 'Form is live' : 'Form hidden', status === 'published' ? 'Attendees now see these questions when they register.' : 'Attendees will only be asked for name, email and phone.')
    },
    onError: (err: Error) => toast.error('Couldn’t update the form', err.message),
  })

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    const changes = next.map((f, i) => ({ f, order: i + 1 })).filter(({ f, order }) => f.order !== order)
    // Show the new order immediately
    queryClient.setQueryData<DynamicForm[]>(['forms'], (old) =>
      old?.map((fm) => (fm.id === form.id ? { ...fm, fields: next.map((f, i) => ({ ...f, order: i + 1 })) } : fm)),
    )
    setBusy(true)
    try {
      await Promise.all(changes.map(({ f, order }) => formsApi.updateField(f.id!, { order })))
      toast.success('Order saved', `“${fields[index].label}” moved ${dir < 0 ? 'up' : 'down'}.`)
    } catch (err) {
      toast.error('Couldn’t reorder the questions', (err as Error).message)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const remove = async (field: FormField) => {
    const ok = await toast.confirm({
      title: `Delete “${field.label}”?`,
      description: 'Answers attendees already gave to this question will be deleted too.',
      confirmLabel: 'Delete question',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await formsApi.deleteField(field.id!)
      if (editing === field.id) setEditing(null)
      toast.success('Question deleted')
    } catch (err) {
      toast.error('Couldn’t delete the question', (err as Error).message)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const previewFields: FormField[] = useMemo(() => {
    if (!editing) return fields
    const live: FormField = {
      ...(editingField ?? { order: Number.MAX_SAFE_INTEGER }),
      id: editing === 'new' ? '__new' : editing,
      label: draft.label || 'Untitled question',
      field_type: draft.field_type,
      placeholder: draft.placeholder,
      help_text: draft.help_text,
      required: draft.required,
      options: parseOptions(draft.options),
    }
    return editing === 'new' ? [...fields, live] : fields.map((f) => (f.id === editing ? live : f))
  }, [fields, editing, editingField, draft])

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader
            title={form.title}
            description={`${fields.length} ${fields.length === 1 ? 'question' : 'questions'}`}
            actions={
              form.status === 'published' ? (
                <Badge tone="success" dot>
                  Live
                </Badge>
              ) : (
                <Badge tone="neutral">Hidden</Badge>
              )
            }
          />
          {form.status !== 'published' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-marigold-50 px-5 py-3 text-sm text-marigold-900">
              <p>Attendees don’t see these questions until you publish the form.</p>
              <Button size="sm" loading={updateFormStatus.isPending} onClick={() => updateFormStatus.mutate('published')}>
                Publish form
              </Button>
            </div>
          )}

          <ol className="divide-y divide-ink-100" aria-label="Questions">
            {['Full name', 'Email', 'Phone number'].map((label) => (
              <li key={label} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Lock className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <span className="flex-1 font-medium text-ink-600">{label}</span>
                <span className="text-xs text-ink-500">Always asked</span>
              </li>
            ))}
            {fields.map((f, i) => {
              const selected = editing === f.id
              return (
                <li key={f.id} className={cn('flex items-center gap-2 py-2 pl-5 pr-3', selected && 'bg-brand-50/60')}>
                  <button
                    type="button"
                    onClick={() => setEditing(f.id!)}
                    aria-current={selected || undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink-100 text-xs font-semibold text-ink-600 tabular">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-900">{f.label}</span>
                      <span className="block text-xs text-ink-500">
                        {typeLabel(f.field_type)}
                        {f.required ? ', required' : ', optional'}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center">
                    <IconButton label={`Move “${f.label}” up`} disabled={i === 0 || busy} onClick={() => move(i, -1)} className="disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Move “${f.label}” down`}
                      disabled={i === fields.length - 1 || busy}
                      onClick={() => move(i, 1)}
                      className="disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Edit “${f.label}”`} onClick={() => setEditing(f.id!)} className="hidden sm:inline-flex">
                      <Pencil className="h-4 w-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Delete “${f.label}”`} disabled={busy} onClick={() => remove(f)} className="hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3">
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} disabled={editing === 'new'}>
              Add question
            </Button>
            {form.status === 'published' && (
              <Button size="sm" variant="ghost" loading={updateFormStatus.isPending} onClick={() => updateFormStatus.mutate('draft')}>
                Hide form
              </Button>
            )}
          </div>
        </Card>

        {editing && (
          <FieldEditor
            key={editing}
            isNew={editing === 'new'}
            draft={draft}
            onChange={setDraft}
            saving={saveField.isPending}
            onSave={() => saveField.mutate(draft)}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>

      <Preview event={event} fields={previewFields} highlightId={editing === 'new' ? '__new' : editing} />
    </div>
  )
}

const FieldEditor: React.FC<{
  isNew: boolean
  draft: FieldDraft
  onChange: (d: FieldDraft) => void
  saving: boolean
  onSave: () => void
  onCancel: () => void
}> = ({ isNew, draft, onChange, saving, onSave, onCancel }) => {
  const toast = useToast()
  const [submitted, setSubmitted] = useState(false)
  const set = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) => onChange({ ...draft, [key]: value })
  const labelError = submitted && !draft.label.trim() ? 'Write the question attendees will see.' : undefined
  const optionsError =
    submitted && hasOptions(draft.field_type) && parseOptions(draft.options).length < 2 ? 'Add at least two choices, one per line.' : undefined

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!draft.label.trim()) {
      toast.error('Question not saved', 'Write the question attendees will see.')
      return
    }
    if (hasOptions(draft.field_type) && parseOptions(draft.options).length < 2) {
      toast.error('Question not saved', 'Add at least two choices, one per line.')
      return
    }
    onSave()
  }

  return (
    <Card>
      <CardHeader title={isNew ? 'New question' : 'Edit question'} description="The preview updates as you type." />
      <form onSubmit={handleSubmit} noValidate className="space-y-4 p-5">
        <Input
          label="Question"
          required
          placeholder="Which college are you from?"
          value={draft.label}
          onChange={(e) => set('label', e.target.value)}
          error={labelError}
          autoFocus={isNew}
        />
        <Select label="Answer type" value={draft.field_type} onChange={(e) => set('field_type', e.target.value as FieldType)}>
          {fieldTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {hasOptions(draft.field_type) && (
          <Textarea
            label="Choices"
            required
            rows={4}
            placeholder={'Small\nMedium\nLarge'}
            hint="One choice per line"
            value={draft.options}
            onChange={(e) => set('options', e.target.value)}
            error={optionsError}
          />
        )}
        {hasPlaceholder(draft.field_type) && (
          <Input
            label="Placeholder"
            placeholder="e.g. Purbanchal Campus"
            hint="Example text shown inside the empty box"
            value={draft.placeholder}
            onChange={(e) => set('placeholder', e.target.value)}
          />
        )}
        <Input
          label="Help text"
          placeholder="Shown under the question"
          value={draft.help_text}
          onChange={(e) => set('help_text', e.target.value)}
          hint="Optional"
        />
        <label className="flex items-center gap-2.5 text-sm font-medium text-ink-800">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => set('required', e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
          />
          Attendees must answer this
        </label>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isNew ? 'Add question' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

const choiceClass = 'h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500/30'

const Preview: React.FC<{ event: Event; fields: FormField[]; highlightId: string | null }> = ({ event, fields, highlightId }) => (
  <Card className="min-w-0 xl:sticky xl:top-20">
    <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 text-sm font-medium text-ink-500">
      <Eye className="h-4 w-4" aria-hidden />
      Preview of what attendees see
    </div>
    <div className="max-h-none space-y-4 bg-ink-50/60 p-4 sm:p-6 xl:max-h-[calc(100dvh-10rem)] xl:overflow-y-auto">
      <div className="space-y-5 rounded-2xl border border-ink-200 bg-white p-5 sm:p-6">
        <div className="border-b border-ink-100 pb-4">
          <h3 className="text-lg font-bold text-ink-900">Register for {event.title}</h3>
          <p className="mt-1 text-sm text-ink-500">You’ll get a QR pass by email right after you submit.</p>
        </div>
        <fieldset className="space-y-4" aria-label="Form preview">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required placeholder="Sita Rai" />
            <Input label="Email" type="email" required placeholder="sita@example.com" />
          </div>
          <Input label="Phone number" type="tel" placeholder="98XXXXXXXX" />
          {fields.map((f, i) => (
            <div
              key={f.id ?? i}
              className={cn('rounded-lg', highlightId === f.id && 'ring-2 ring-brand-200 ring-offset-4')}
            >
              <PreviewField field={f} />
            </div>
          ))}
        </fieldset>
        <Button className="w-full" size="lg" icon={<TicketIcon className="h-4 w-4" />} disabled>
          Register
        </Button>
        <p className="text-center text-xs text-ink-500">Preview only. Submitting is turned off here.</p>
      </div>
    </div>
  </Card>
)

const PreviewField: React.FC<{ field: FormField }> = ({ field: f }) => {
  const hint = f.help_text || undefined
  const placeholder = f.placeholder || undefined
  switch (f.field_type) {
    case 'paragraph':
      return <Textarea label={f.label} required={f.required} hint={hint} placeholder={placeholder} rows={3} />
    case 'select':
      return (
        <Select label={f.label} required={f.required} hint={hint} defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      )
    case 'radio':
    case 'checkbox':
      return (
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">
            {f.label}
            {f.required && <span className="ml-0.5 text-brand-600" aria-hidden>*</span>}
          </legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {(f.options?.length ? f.options : ['Choice 1', 'Choice 2']).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type={f.field_type}
                  name={`preview-${f.id}`}
                  className={cn(choiceClass, f.field_type === 'checkbox' && 'rounded')}
                />
                {o}
              </label>
            ))}
          </div>
          {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
        </fieldset>
      )
    default: {
      const type = { text: 'text', number: 'number', email: 'email', phone: 'tel', date: 'date' }[f.field_type] ?? 'text'
      return <Input label={f.label} type={type} required={f.required} hint={hint} placeholder={placeholder} />
    }
  }
}
