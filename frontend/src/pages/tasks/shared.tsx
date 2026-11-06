import React, { useId } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, CircleDot, Pencil, Trash2, User } from 'lucide-react'
import { Badge, IconButton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { categoryLabels, fmtDue, isOverdue, priorityMeta, statusMeta, taskApi, type Task, type TaskStatus } from './api'

export const columns: { status: TaskStatus; icon: React.ElementType; iconClass: string; empty: string }[] = [
  { status: 'todo', icon: Circle, iconClass: 'text-ink-400', empty: 'Nothing waiting.' },
  { status: 'in_progress', icon: CircleDot, iconClass: 'text-marigold-600', empty: 'No one is working on anything yet.' },
  { status: 'completed', icon: CheckCircle2, iconClass: 'text-emerald-600', empty: 'Finished tasks land here.' },
]

/** Invalidate every cache that shows tasks or task counts. */
export function useInvalidateTasks() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['eventTasks'] })
    queryClient.invalidateQueries({ queryKey: ['analytics'] })
  }
}

/** Status change (optimistic) and delete (with confirmation), both with toasts. */
export function useTaskActions(listKey: readonly unknown[]) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateTasks()

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => taskApi.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<Task[]>(listKey)
      queryClient.setQueryData<Task[]>(listKey, (old = []) => old.map((t) => (t.id === id ? { ...t, status } : t)))
      return { previous }
    },
    onSuccess: (_res, { status }) => toast.success(`Moved to ${statusMeta[status].label.toLowerCase()}`),
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous)
      toast.error('Couldn’t move the task', err.message)
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => taskApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success('Task deleted')
    },
    onError: (err: Error) => toast.error('Couldn’t delete the task', err.message),
  })

  const confirmDelete = async (task: Task) => {
    const ok = await toast.confirm({
      title: 'Delete this task?',
      description: `“${task.title}” will be removed for everyone on the crew.`,
      confirmLabel: 'Delete task',
      danger: true,
    })
    if (ok) remove.mutate(task.id)
  }

  return {
    setStatus: (task: Task, status: TaskStatus) => updateStatus.mutate({ id: task.id, status }),
    confirmDelete,
  }
}

export const EventTag: React.FC<{ task: Task; linkTo?: (eventId: string) => string }> = ({ task, linkTo }) =>
  task.event ? (
    linkTo ? (
      <Link
        to={linkTo(task.event)}
        className="inline-flex max-w-full items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
      >
        <span className="truncate">{task.event_title}</span>
      </Link>
    ) : (
      <Badge tone="brand" className="max-w-full">
        <span className="truncate">{task.event_title}</span>
      </Badge>
    )
  ) : (
    <Badge>General</Badge>
  )

export const StatusSelect: React.FC<{ task: Task; onChange: (s: TaskStatus) => void; className?: string }> = ({
  task,
  onChange,
  className,
}) => {
  const id = useId()
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Status of {task.title}
      </label>
      <select
        id={id}
        value={task.status}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
        className={cn(
          'h-8 shrink-0 rounded-lg border border-ink-200 bg-white py-0 pl-2 pr-7 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          className,
        )}
      >
        {columns.map((c) => (
          <option key={c.status} value={c.status}>
            {statusMeta[c.status].label}
          </option>
        ))}
      </select>
    </>
  )
}

export const DueLabel: React.FC<{ task: Task }> = ({ task }) => {
  const due = fmtDue(task)
  if (!due) return null
  const late = isOverdue(task)
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', late ? 'font-medium text-red-700' : 'text-ink-500')}>
      {late ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden />}
      {late ? `Overdue, ${due}` : `Due ${due}`}
    </span>
  )
}

interface TaskCardProps {
  task: Task
  editHref: string
  showEvent?: boolean
  eventHref?: (eventId: string) => string
  onStatusChange: (s: TaskStatus) => void
  onDelete: () => void
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, editHref, showEvent, eventHref, onStatusChange, onDelete }) => {
  const p = priorityMeta[task.priority]
  return (
    <li className="rounded-xl border border-ink-200 bg-white p-3.5 shadow-2xs">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={editHref}
          className={cn(
            'min-w-0 text-sm font-semibold leading-snug hover:text-brand-700 hover:underline',
            task.status === 'completed' ? 'text-ink-600' : 'text-ink-900',
          )}
        >
          {task.title}
        </Link>
        <div className="-mr-1.5 -mt-1.5 flex shrink-0">
          <Link
            to={editHref}
            aria-label={`Edit task: ${task.title}`}
            title="Edit task"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Link>
          <IconButton label={`Delete task: ${task.title}`} onClick={onDelete} className="h-8 w-8 hover:bg-red-50 hover:text-red-700">
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      {task.description && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{task.description}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {showEvent && <EventTag task={task} linkTo={eventHref} />}
        <Badge>{categoryLabels[task.category] ?? task.category}</Badge>
        {task.status !== 'completed' && (task.priority === 'urgent' || task.priority === 'high') && <Badge tone={p.tone}>{p.label}</Badge>}
      </div>
      {fmtDue(task) && (
        <div className="mt-2">
          <DueLabel task={task} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-600">
          <User className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
          <span className="truncate">{task.assigned_name || <span className="text-ink-400">Unassigned</span>}</span>
        </span>
        <StatusSelect task={task} onChange={onStatusChange} />
      </div>
    </li>
  )
}

interface TaskBoardProps {
  tasks: Task[]
  editHref: (task: Task) => string
  showEvent?: boolean
  eventHref?: (eventId: string) => string
  onStatusChange: (task: Task, s: TaskStatus) => void
  onDelete: (task: Task) => void
  visibleStatuses?: TaskStatus[]
}

export const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  editHref,
  showEvent,
  eventHref,
  onStatusChange,
  onDelete,
  visibleStatuses,
}) => {
  const cols = visibleStatuses ? columns.filter((c) => visibleStatuses.includes(c.status)) : columns
  return (
    <div className={cn('grid gap-4', cols.length === 3 ? 'md:grid-cols-3' : cols.length === 2 ? 'md:grid-cols-2' : '')}>
      {cols.map(({ status, icon: Icon, iconClass, empty }) => {
        const items = tasks.filter((t) => t.status === status)
        const label = statusMeta[status].label
        return (
          <section key={status} aria-label={label} className="rounded-2xl border border-ink-200 bg-ink-50/70 p-3">
            <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-ink-800">
              <Icon className={cn('h-4 w-4', iconClass)} aria-hidden />
              {label}
              <span className="ml-auto rounded-full bg-white px-2 text-xs font-medium tabular text-ink-500 ring-1 ring-ink-200">
                {items.length}
              </span>
            </h3>
            {items.length ? (
              <ul className="space-y-2.5">
                {items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    editHref={editHref(task)}
                    showEvent={showEvent}
                    eventHref={eventHref}
                    onStatusChange={(s) => onStatusChange(task, s)}
                    onDelete={() => onDelete(task)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-1 py-6 text-center text-sm text-ink-500">{empty}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
