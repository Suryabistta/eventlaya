import { request } from '@/services/api'

export type TaskStatus = 'todo' | 'in_progress' | 'completed'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskCategory = 'stage' | 'gate' | 'hospitality' | 'marketing' | 'catering' | 'tech'

/** A crew task. `event` is null for general tasks that aren't tied to an event. */
export interface Task {
  id: string
  organizer: string
  event: string | null
  event_title: string | null
  title: string
  description: string
  assigned_to: string | null
  assigned_email: string
  assigned_name: string
  assignee_email: string
  status: TaskStatus
  priority: TaskPriority
  category: TaskCategory
  due_date: string | null
  due_time: string | null
  created_at: string
  updated_at: string
}

export type TaskInput = Partial<
  Pick<
    Task,
    'event' | 'title' | 'description' | 'assigned_name' | 'assignee_email' | 'status' | 'priority' | 'category' | 'due_date' | 'due_time'
  >
>

export const taskApi = {
  list: () => request<Task[]>('/events/tasks/'),
  forEvent: (eventId: string) => request<Task[]>(`/events/tasks/?event_id=${encodeURIComponent(eventId)}`),
  get: (id: string) => request<Task>(`/events/tasks/${id}/`),
  create: (body: TaskInput) => request<Task>('/events/tasks/', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: TaskInput) => request<Task>(`/events/tasks/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => request<null>(`/events/tasks/${id}/`, { method: 'DELETE' }),
}

export const statusMeta: Record<TaskStatus, { label: string }> = {
  todo: { label: 'To do' },
  in_progress: { label: 'In progress' },
  completed: { label: 'Done' },
}

export const priorityMeta: Record<TaskPriority, { label: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  urgent: { label: 'Urgent', tone: 'danger' },
  high: { label: 'High', tone: 'warning' },
  medium: { label: 'Medium', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
}

export const categoryLabels: Record<TaskCategory, string> = {
  gate: 'Gate and security',
  stage: 'Stage and sound',
  hospitality: 'Guests and hospitality',
  tech: 'Tech and livestream',
  catering: 'Catering',
  marketing: 'Media and photos',
}

/** Due date as a Date, from due_time if set, else due_date (end of day not assumed). */
export function taskDue(task: Task): { date: Date; hasTime: boolean } | null {
  if (task.due_time) return { date: new Date(task.due_time), hasTime: true }
  if (task.due_date) return { date: new Date(`${task.due_date}T00:00:00`), hasTime: false }
  return null
}

export function fmtDue(task: Task): string | null {
  const due = taskDue(task)
  if (!due) return null
  const day = due.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return due.hasTime ? `${day}, ${due.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : day
}

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isOverdue(task: Task): boolean {
  if (task.status === 'completed') return false
  if (task.due_time) return new Date(task.due_time) < new Date()
  return Boolean(task.due_date && task.due_date < localToday())
}
