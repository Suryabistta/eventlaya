import React, { useEffect, useMemo, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { Button, Card, ErrorState, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import {
  categoryLabels,
  priorityMeta,
  statusMeta,
  taskApi,
  type Task,
  type TaskCategory,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from './api'
import { useInvalidateTasks } from './shared'

interface Draft {
  title: string
  description: string
  event: string // '' = general
  assigned_name: string
  assignee_email: string
  due_date: string
  due_time: string // HH:MM
  priority: TaskPriority
  category: TaskCategory
  status: TaskStatus
}

const pad = (n: number) => String(n).padStart(2, '0')

function fromTask(t: Task): Draft {
  const dt = t.due_time ? new Date(t.due_time) : null
  return {
    title: t.title,
    description: t.description ?? '',
    event: t.event ?? '',
    assigned_name: t.assigned_name ?? '',
    assignee_email: t.assignee_email ?? '',
    due_date: t.due_date ?? (dt ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : ''),
    due_time: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
    priority: t.priority,
    category: t.category,
    status: t.status,
  }
}

/** Only allow returning to pages inside the app. */
function safeReturn(value: string | null, fallback: string) {
  return value && value.startsWith('/app') ? value : fallback
}

export const TaskFormPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>()
  const {
    data: task,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => taskApi.get(id!),
    enabled: Boolean(id),
  })
  const toast = useToast()

  useEffect(() => {
    if (isError) toast.error('Couldn’t load this task', (error as Error)?.message)
  }, [isError, error, toast])

  if (id && isError) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <PageHeader title="Edit task" />
        <ErrorState message={`${(error as Error)?.message ?? ''} The task may have been deleted.`} onRetry={() => void refetch()} />
      </div>
    )
  }
  if (id && (isLoading || !task)) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }
  return <TaskForm key={task?.id ?? 'new'} task={task} />
}

const TaskForm: React.FC<{ task?: Task }> = ({ task }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { events } = useCurrentEvent()
  const invalidate = useInvalidateTasks()
  const isEdit = Boolean(task)
  const returnTo = safeReturn(params.get('return'), '/app/tasks')

  const initial = useMemo<Draft>(() => {
    if (task) return fromTask(task)
    const requested = params.get('event')
    return {
      title: '',
      description: '',
      event: requested && requested !== 'none' ? requested : '',
      assigned_name: '',
      assignee_email: '',
      due_date: '',
      due_time: '',
      priority: 'medium',
      category: 'gate',
      status: 'todo',
    }
    // Only computed once per mounted form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])

  const [draft, setDraft] = useState<Draft>(initial)
  const [submitted, setSubmitted] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const titleError = submitted && !draft.title.trim() ? 'Give the task a short name.' : undefined
  const timeError = submitted && draft.due_time && !draft.due_date ? 'Pick a date for this time.' : undefined
  const emailError =
    submitted && draft.assignee_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.assignee_email.trim())
      ? 'Enter a full email address, like ram@example.com.'
      : undefined

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const save = useMutation({
    mutationFn: (body: TaskInput) => (task ? taskApi.update(task.id, body) : taskApi.create(body)),
    onSuccess: (saved) => {
      invalidate()
      toast.success(
        isEdit ? 'Task updated' : 'Task added',
        saved.event_title ? `${saved.title}, for ${saved.event_title}` : `${saved.title}, general task`,
      )
      navigate(returnTo)
    },
    onError: (err: Error) => toast.error(isEdit ? 'Couldn’t save the task' : 'Couldn’t add the task', err.message),
  })

  const remove = useMutation({
    mutationFn: () => taskApi.remove(task!.id),
    onSuccess: () => {
      invalidate()
      toast.success('Task deleted')
      navigate(returnTo)
    },
    onError: (err: Error) => toast.error('Couldn’t delete the task', err.message),
  })

  const leave = async () => {
    if (dirty && !save.isPending) {
      const ok = await toast.confirm({
        title: 'Discard your changes?',
        description: isEdit
          ? 'Your edits to this task haven’t been saved.'
          : 'This task hasn’t been added yet. What you’ve typed will be lost.',
        confirmLabel: 'Discard changes',
        danger: true,
      })
      if (!ok) return
    }
    navigate(returnTo)
  }

  const confirmDelete = async () => {
    const ok = await toast.confirm({
      title: 'Delete this task?',
      description: `“${task!.title}” will be removed for everyone on the crew.`,
      confirmLabel: 'Delete task',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    const problems = [
      !draft.title.trim() && 'Task',
      draft.due_time && !draft.due_date && 'Due date',
      draft.assignee_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.assignee_email.trim()) && 'Email',
    ].filter(Boolean) as string[]
    if (problems.length) {
      toast.error(problems.length === 1 ? 'Fix 1 field before saving' : `Fix ${problems.length} fields before saving`, problems.join(', '))
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    save.mutate({
      title: draft.title.trim(),
      description: draft.description.trim(),
      event: draft.event || null,
      assigned_name: draft.assigned_name.trim(),
      assignee_email: draft.assignee_email.trim(),
      due_date: draft.due_date || null,
      due_time: draft.due_date && draft.due_time ? new Date(`${draft.due_date}T${draft.due_time}`).toISOString() : null,
      priority: draft.priority,
      category: draft.category,
      ...(isEdit ? { status: draft.status } : {}),
    })
  }

  const submitLabel = isEdit ? 'Save changes' : 'Add task'
  const linkedEvent = events.find((e) => e.id === draft.event)

  return (
    <div className="w-full space-y-6 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-8 2xl:px-10">
      <div className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-ink-500">
            <li>
              <Link
                to="/app/tasks"
                onClick={(e) => {
                  e.preventDefault()
                  void leave()
                }}
                className="font-medium hover:text-ink-900 hover:underline"
              >
                Tasks
              </Link>
            </li>
            <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
            <li aria-current="page" className="truncate text-ink-700">
              {isEdit ? task!.title : 'New task'}
            </li>
          </ol>
        </nav>
        <PageHeader
          title={isEdit ? 'Edit task' : 'New task'}
          description={
            isEdit ? 'Changes show on the crew board straight away.' : 'Link it to an event, or keep it as a general task for your team.'
          }
        />
      </div>

      <form id="task-form" onSubmit={handleSubmit} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Section title="What" description="A short name the crew will recognise.">
            <Input
              label="Task"
              required
              autoFocus={!isEdit}
              placeholder="Sound check on the main stage"
              value={draft.title}
              error={titleError}
              onChange={(e) => set('title', e.target.value)}
            />
            <Textarea
              label="Notes"
              rows={4}
              hint="Optional. What needs to happen, and anything to bring."
              placeholder="Test both wireless mics and the backup cable"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Section>

          <Section title="Event" description="Linked tasks show on that event’s crew board.">
            <Select label="Linked event" value={draft.event} onChange={(e) => set('event', e.target.value)}>
              <option value="">General (not tied to an event)</option>
              {task?.event && !events.some((ev) => ev.id === task.event) && <option value={task.event}>{task.event_title}</option>}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </Select>
          </Section>

          <Section title="Who" description="The person responsible for getting it done.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Assigned to"
                placeholder="Ramesh Adhikari, gate lead"
                hint="Name or role"
                value={draft.assigned_name}
                onChange={(e) => set('assigned_name', e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                inputMode="email"
                placeholder="ramesh@example.com"
                hint="Optional"
                value={draft.assignee_email}
                error={emailError}
                onChange={(e) => set('assignee_email', e.target.value)}
              />
            </div>
          </Section>

          <Section title="When" description="Leave empty if there’s no deadline.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Due date"
                type="date"
                hint="Optional"
                value={draft.due_date}
                error={timeError}
                onChange={(e) => set('due_date', e.target.value)}
              />
              <Input
                label="Due time"
                type="time"
                hint="Optional"
                value={draft.due_time}
                onChange={(e) => set('due_time', e.target.value)}
              />
            </div>
          </Section>

          <Section title="Priority and area">
            <div className={isEdit ? 'grid gap-4 sm:grid-cols-3' : 'grid gap-4 sm:grid-cols-2'}>
              <Select label="Priority" value={draft.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                  <option key={p} value={p}>
                    {priorityMeta[p].label}
                  </option>
                ))}
              </Select>
              <Select label="Area" value={draft.category} onChange={(e) => set('category', e.target.value as TaskCategory)}>
                {(Object.keys(categoryLabels) as TaskCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {categoryLabels[c]}
                  </option>
                ))}
              </Select>
              {isEdit && (
                <Select label="Status" value={draft.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
                  {(Object.keys(statusMeta) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {statusMeta[s].label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="p-5">
            <p className="text-sm font-medium text-ink-500">Summary</p>
            <p className="mt-1 break-words font-display text-lg font-bold text-ink-900">{draft.title.trim() || 'Untitled task'}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <SummaryRow label="Event" value={linkedEvent ? linkedEvent.title : 'General'} />
              <SummaryRow label="Assigned to" value={draft.assigned_name.trim() || 'No one yet'} />
              <SummaryRow
                label="Due"
                value={
                  draft.due_date
                    ? `${formatDate(new Date(`${draft.due_date}T00:00:00`), 'medium')}${draft.due_time ? `, ${draft.due_time}` : ''}`
                    : 'No deadline'
                }
              />
              <SummaryRow label="Priority" value={priorityMeta[draft.priority].label} />
            </dl>
          </Card>
          <div className="hidden gap-2 lg:flex">
            <Button variant="secondary" className="flex-1" onClick={() => void leave()}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={save.isPending}>
              {submitLabel}
            </Button>
          </div>
          {isEdit && (
            <Button
              variant="ghost"
              className="w-full text-red-700 hover:bg-red-50 hover:text-red-800"
              icon={<Trash2 className="h-4 w-4" />}
              loading={remove.isPending}
              onClick={confirmDelete}
            >
              Delete task
            </Button>
          )}
        </aside>
      </form>

      {/* Phone/tablet: actions docked just above the app's bottom tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:bottom-0 lg:hidden">
        <div className="flex gap-2 px-4 py-3 sm:px-6">
          <Button variant="secondary" className="flex-1" onClick={() => void leave()}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" className="flex-1" loading={save.isPending}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <dt className="shrink-0 text-ink-500">{label}</dt>
    <dd className="min-w-0 break-words text-right font-medium text-ink-800">{value}</dd>
  </div>
)

const Section: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <Card>
    <section className="space-y-4 p-5 sm:p-6" aria-label={title}>
      <div>
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {children}
    </section>
  </Card>
)

export default TaskFormPage
