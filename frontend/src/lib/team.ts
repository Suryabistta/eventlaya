import { request } from '@/services/api'

export interface TeamAssignment {
  id: string
  event_id: string
  event_title: string
  gate_id: string | null
  gate_name: string
  is_active: boolean
}

export interface TeamMember {
  id: string
  name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  is_active: boolean
  date_joined: string
  last_login: string | null
  assignments: TeamAssignment[]
}

export interface NewTeamMember {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  /** Leave out to have the server generate a temporary password. */
  password?: string
}

export interface TeamMemberUpdate {
  first_name?: string
  last_name?: string
  phone?: string
  is_active?: boolean
  reset_password?: true
}

export const TEAM_KEY = ['team'] as const

export const teamApi = {
  list: () => request<TeamMember[]>('/auth/team/'),
  create: (body: NewTeamMember) =>
    request<TeamMember & { message: string; temporary_password: string | null; created: boolean }>('/auth/team/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: TeamMemberUpdate) =>
    request<TeamMember & { temporary_password: string | null }>(`/auth/team/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ message: string }>(`/auth/team/${id}/`, { method: 'DELETE' }),
}
