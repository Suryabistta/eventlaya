import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ClipboardList, Plus } from 'lucide-react'
import { ButtonLink, Card, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui'
import { taskApi } from '../tasks/api'
import { TaskBoard, useTaskActions } from '../tasks/shared'

/** The current event's crew board. Creating and editing happen on the task form page. */
export const TasksSection: React.FC<{ eventId: string }> = ({ eventId }) => {
  const toast = useToast()
  const key = ['tasks', 'event', eventId] as const
  const { data: tasks = [], isLoading, isError, error, refetch } = useQuery({ queryKey: key, queryFn: () => taskApi.forEvent(eventId) })
  const { setStatus, confirmDelete } = useTaskActions(key)

  useEffect(() => {
    if (isError) toast.error('Couldn’t load crew tasks', (error as Error)?.message)
  }, [isError, error, toast])

  const returnTo = encodeURIComponent('/app/analytics?tab=crew')
  const newHref = `/app/tasks/new?event=${eventId}&return=${returnTo}`
  const openTasks = tasks.filter((t) => t.status !== 'completed')
  const urgent = openTasks.filter((t) => t.priority === 'urgent').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
          {tasks.length === 0 ? (
            <span>Split the work for this event between your crew.</span>
          ) : (
            <span>
              {tasks.length - openTasks.length} of {tasks.length} done
            </span>
          )}
          {urgent > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {urgent} urgent {urgent === 1 ? 'task' : 'tasks'} open
            </span>
          )}
          <Link to={`/app/tasks?event=${eventId}`} className="font-medium text-brand-700 hover:underline">
            Open in all tasks
          </Link>
        </div>
        <ButtonLink to={newHref} size="sm" icon={<Plus className="h-4 w-4" />}>
          Add task
        </ButtonLink>
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No crew tasks for this event"
            description="Add jobs like sound check, gate setup or catering pickup, and assign each one to a person."
            action={
              <ButtonLink to={newHref} icon={<Plus className="h-4 w-4" />}>
                Add the first task
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <TaskBoard
          tasks={tasks}
          editHref={(t) => `/app/tasks/${t.id}/edit?return=${returnTo}`}
          onStatusChange={setStatus}
          onDelete={confirmDelete}
        />
      )}
    </div>
  )
}
