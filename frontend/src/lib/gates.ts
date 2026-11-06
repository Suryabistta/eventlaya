import { request } from '@/services/api'

export type GateKind = 'entry' | 'exit' | 'both'
export type ScanMode = 'gate_in' | 'gate_out'

export interface GateStaff {
  id: string
  staff_id: string
  staff_name: string
  staff_email: string
  gate_id: string | null
  gate_name: string
  is_active: boolean
}

export interface EventGate {
  id: string
  event: string
  name: string
  kind: GateKind
  is_vip: boolean
  is_active: boolean
  order: number
  scans_in_today: number
  scans_out_today: number
  /** Only returned to the event organizer */
  staff?: GateStaff[]
}

export interface MyAssignment {
  id: string
  gate_name: string
  gate: EventGate | null
  event: { id: string; title: string; slug: string; date: string; venue: string }
}

export const gateKindLabel: Record<GateKind, string> = {
  both: 'Entry and exit',
  entry: 'Entry only',
  exit: 'Exit only',
}

export const gateAllows = (kind: GateKind, mode: ScanMode) => kind === 'both' || (kind === 'entry' ? mode === 'gate_in' : mode === 'gate_out')

export const gatesApi = {
  list: (eventId: string) => request<EventGate[]>(`/events/${eventId}/gates/`),
  create: (eventId: string, body: Partial<Pick<EventGate, 'name' | 'kind' | 'is_vip' | 'is_active' | 'order'>>) =>
    request<EventGate>(`/events/${eventId}/gates/`, { method: 'POST', body: JSON.stringify(body) }),
  update: (eventId: string, gateId: string, body: Partial<Pick<EventGate, 'name' | 'kind' | 'is_vip' | 'is_active' | 'order'>>) =>
    request<EventGate>(`/events/${eventId}/gates/${gateId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (eventId: string, gateId: string) =>
    request<{ deleted: boolean; deactivated: boolean; message: string }>(`/events/${eventId}/gates/${gateId}/`, { method: 'DELETE' }),
  assignments: (eventId: string) => request<GateStaff[]>(`/events/staff-assign/?event_id=${eventId}`),
  assign: (eventId: string, gateId: string, email: string) =>
    request<GateStaff & { message: string; staff_created: boolean; temporary_password: string | null }>('/events/staff-assign/', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, gate_id: gateId, staff_email: email }),
    }),
  unassign: (assignmentId: string) =>
    request<{ message: string }>('/events/staff-assign/', { method: 'DELETE', body: JSON.stringify({ assignment_id: assignmentId }) }),
  myAssignment: (eventId?: string) => request<MyAssignment>(`/events/my-assignment/${eventId ? `?event_id=${eventId}` : ''}`),
}
