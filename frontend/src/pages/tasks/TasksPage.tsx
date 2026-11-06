import React, { useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Columns3, List, Pencil, Plus, Search, Trash2, User } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { categoryLabels, priorityMeta, statusMeta, taskApi, type Task, type TaskPriority, type TaskStatus } from './api'
import { DueLabel, EventTag, StatusSelect, TaskBoard, useTaskActions } from './shared'

const LIST_KEY = ['tasks', 'all'] as const
const priorityOrder: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

export const TasksPage: React.FC = () => {
  const toast = useToast()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { events } = useCurrentEvent()

  const eventFilter = params.get('event') ?? 'all' // 'all' | 'none' | <event id>
  const statusFilter = (params.get('status') ?? 'all') as TaskStatus | 'all'
  const priorityFilter = (params.get('priority') ?? 'all') as TaskPriority | 'all'
  const query = params.get('q') ?? ''
  const view = params.get('view') === 'list' ? 'list' : 'board'

  const setParam = (key: string, value: string, fallback = 'all') =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (!value || value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const { data: tasks = [], isLoading, isError, error, refetch } = useQuery({ queryKey: LIST_KEY, queryFn: taskApi.list })
  const { setStatus, confirmDelete } = useTaskActions(LIST_KEY)

  useEffect(() => {
    if (isError) toast.error('Couldn’t load tasks', (error as Error)?.message)
  }, [isError, error, toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter((t) => (eventFilter === 'all' ? true : eventFilter === 'none' ? !t.event : t.event === eventFilter))
      .filter((t) => statusFilter === 'all' || t.status === statusFilter)
      .filter((t) => priorityFilter === 'all' || t.priority === priorityFilter)
      .filter((t) => !q || t.assigned_name.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
  }, [tasks, eventFilter, statusFilter, priorityFilter, query])

  const filtersActive = eventFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || Boolean(query)
  const returnTo = encodeURIComponent(location.pathname + location.search)
  const newHref = `/app/tasks/new?${eventFilter !== 'all' ? `event=${eventFilter}&` : ''}return=${returnTo}`
  const editHref = (t: Task) => `/app/tasks/${t.id}/edit?return=${returnTo}`
  const eventHref = (id: string) => `/app/tasks?event=${id}`
  const openCount = tasks.filter((t) => t.status !== 'completed').length

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Tasks"
        description={
          tasks.length
            ? `${openCount} open across your events and workspace.`
            : 'Jobs for your crew, for an event or for the business in general.'
        }
        actions={
          <ButtonLink to={newHref} icon={<Plus className="h-4 w-4" />}>
            New task
          </ButtonLink>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <Select
            label="Event"
            containerClassName="col-span-2 lg:col-span-1"
            value={eventFilter}
            onChange={(e) => setParam('event', e.target.value)}
          >
            <option value="all">All events and general</option>
            <option value="none">General (not linked to an event)</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
          <Select label="Status" value={statusFilter} onChange={(e) => setParam('status', e.target.value)}>
            <option value="all">Any status</option>
            {(Object.keys(statusMeta) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusMeta[s].label}
              </option>
            ))}
          </Select>
          <Select label="Priority" value={priorityFilter} onChange={(e) => setParam('priority', e.target.value)}>
            <option value="all">Any priority</option>
            {priorityOrder.map((p) => (
              <option key={p} value={p}>
                {priorityMeta[p].label}
              </option>
            ))}
          </Select>
          <div className="col-span-2 space-y-1.5 lg:col-span-1">
            <label htmlFor="task-search" className="block text-sm font-medium text-ink-800">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="task-search"
                type="search"
                value={query}
                onChange={(e) => setParam('q', e.target.value, '')}
                placeholder="Assignee or task name"
                className="block h-[38px] w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <div
            role="group"
            aria-label="Layout"
            className="inline-flex h-[38px] col-span-2 self-end justify-self-start rounded-[10px] bg-ink-100 p-1 lg:col-span-1"
          >
            {(
              [
                ['board', 'Board', Columns3],
                ['list', 'List', List],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setParam('view', value, 'board')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                  view === value ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No tasks yet"
            description="Add jobs like sound check, gate setup or renewing a rental contract, and assign each one to a person."
            action={
              <ButtonLink to={newHref} icon={<Plus className="h-4 w-4" />}>
                Add the first task
              </ButtonLink>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No tasks match these filters"
            description="Try another event or status, or clear the filters to see everything."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {filtersActive && (
                  <Button variant="secondary" onClick={() => setParams(view === 'list' ? { view: 'list' } : {}, { replace: true })}>
                    Clear filters
                  </Button>
                )}
                <ButtonLink to={newHref} icon={<Plus className="h-4 w-4" />}>
                  New task
                </ButtonLink>
              </div>
            }
          />
        </Card>
      ) : view === 'board' ? (
        <TaskBoard
          tasks={filtered}
          editHref={editHref}
          showEvent={eventFilter === 'all'}
          eventHref={eventHref}
          onStatusChange={setStatus}
          onDelete={confirmDelete}
          visibleStatuses={statusFilter === 'all' ? undefined : [statusFilter]}
        />
      ) : (
        <TaskTable tasks={filtered} editHref={editHref} eventHref={eventHref} onStatusChange={setStatus} onDelete={confirmDelete} />
      )}
    </div>
  )
}

const TaskTable: React.FC<{
  tasks: Task[]
  editHref: (t: Task) => string
  eventHref: (id: string) => string
  onStatusChange: (t: Task, s: TaskStatus) => void
  onDelete: (t: Task) => void
}> = ({ tasks, editHref, eventHref, onStatusChange, onDelete }) => (
  <Card className="overflow-hidden">
    {/* Phones: stacked rows instead of a table */}
    <ul className="divide-y divide-ink-100 sm:hidden">
      {tasks.map((t) => (
        <li key={t.id} className="space-y-2 px-4 py-3.5">
          <Link to={editHref(t)} className="block font-semibold text-ink-900 hover:text-brand-700 hover:underline">
            {t.title}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <EventTag task={t} linkTo={eventHref} />
            <DueLabel task={t} />
            {t.status !== 'completed' && (t.priority === 'urgent' || t.priority === 'high') && (
              <Badge tone={priorityMeta[t.priority].tone}>{priorityMeta[t.priority].label}</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-600">
              <User className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
              <span className="truncate">{t.assigned_name || 'Unassigned'}</span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <StatusSelect task={t} onChange={(s) => onStatusChange(t, s)} />
              <IconButton label={`Delete task: ${t.title}`} onClick={() => onDelete(t)} className="hover:bg-red-50 hover:text-red-700">
                <Trash2 className="h-4 w-4" aria-hidden />
              </IconButton>
            </div>
          </div>
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-ink-50 text-xs font-medium text-ink-500">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">
              Task
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
              Event
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Assigned to
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Priority
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {tasks.map((t) => {
            const p = priorityMeta[t.priority]
            return (
              <tr key={t.id} className="hover:bg-ink-50/70">
                <td className="max-w-[340px] px-5 py-3">
                  <Link to={editHref(t)} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {t.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs text-ink-500">{categoryLabels[t.category]}</span>
                    <DueLabel task={t} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                    <EventTag task={t} linkTo={eventHref} />
                    {t.assigned_name && (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-600 lg:hidden">
                        <User className="h-3.5 w-3.5 text-ink-400" aria-hidden />
                        {t.assigned_name}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden max-w-[220px] px-4 py-3 md:table-cell">
                  <EventTag task={t} linkTo={eventHref} />
                </td>
                <td className="hidden px-4 py-3 text-ink-700 lg:table-cell">
                  {t.assigned_name || <span className="text-ink-400">Unassigned</span>}
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <Badge tone={p.tone}>{p.label}</Badge>
                </td>
                <td className="px-4 py-3">
                  <StatusSelect task={t} onChange={(s) => onStatusChange(t, s)} />
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end">
                    <Link
                      to={editHref(t)}
                      aria-label={`Edit task: ${t.title}`}
                      title="Edit task"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Link>
                    <IconButton
                      label={`Delete task: ${t.title}`}
                      onClick={() => onDelete(t)}
                      className="hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </IconButton>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </Card>
)

export default TasksPage
