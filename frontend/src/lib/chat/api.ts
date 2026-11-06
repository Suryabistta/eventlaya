import { request } from '@/services/api'

/** Team chat REST API (/api/chat/), shapes from backend/apps/chat/services.py. */

export interface ChatUser {
  id: string
  name: string
  email: string
  role: string
  avatar: string | null
}

export interface ChatAttachment {
  url: string
  name: string
  mime: string
  size: number | null
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender: ChatUser | null
  body: string
  attachment: ChatAttachment | null
  reply_to: {
    id: string
    sender_id: string | null
    sender_name: string | null
    body: string
    has_attachment: boolean
    is_deleted: boolean
  } | null
  client_id: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  is_deleted: boolean
  /** Client-only: optimistic message waiting for the server, or one that failed to send */
  pending?: boolean
  failed?: boolean
}

export interface ChatMember {
  user: ChatUser
  role: 'admin' | 'member'
  joined_at: string | null
  last_read_at: string | null
  last_read_message_id: string | null
}

export interface Conversation {
  id: string
  kind: 'direct' | 'group'
  title: string
  is_event_crew: boolean
  event: { id: string; title: string } | null
  owner_id: string
  created_by_id: string | null
  created_at: string
  last_message_at: string | null
  last_message: ChatMessage | null
  unread_count: number
  muted: boolean
  my_role: 'admin' | 'member'
  member_count: number
  other_member: ChatUser | null
  read_only: boolean
  last_read_message_id: string | null
  /** Detail endpoint and realtime updates only */
  members?: ChatMember[]
}

export interface MessagePage {
  results: ChatMessage[]
  has_more: boolean
  next_before?: string | null
  next_after?: string | null
  order: 'newest_first' | 'oldest_first'
}

export interface UnreadSummary {
  unread: number
  unread_conversations: number
  unread_including_muted: number
}

export interface SendInput {
  body?: string
  attachment?: { url: string; name?: string } | null
  reply_to?: string | null
  client_id?: string
}

const json = (body: unknown) => JSON.stringify(body)
const C = '/chat/conversations/'

export const chatApi = {
  conversations: () => request<Conversation[]>(C),
  conversation: (id: string) => request<Conversation>(`${C}${id}/`),
  startDirect: (user_id: string) => request<Conversation>(C, { method: 'POST', body: json({ kind: 'direct', user_id }) }),
  createGroup: (title: string, user_ids: string[]) => request<Conversation>(C, { method: 'POST', body: json({ kind: 'group', title, user_ids }) }),
  rename: (id: string, title: string) => request<Conversation>(`${C}${id}/`, { method: 'PATCH', body: json({ title }) }),
  mute: (id: string, muted: boolean) => request<Conversation>(`${C}${id}/mute/`, { method: 'POST', body: json({ muted }) }),
  leave: (id: string) => request<{ message: string }>(`${C}${id}/leave/`, { method: 'POST' }),
  addMembers: (id: string, user_ids: string[]) => request<Conversation>(`${C}${id}/members/`, { method: 'POST', body: json({ user_ids }) }),
  setRole: (id: string, userId: string, role: 'admin' | 'member') =>
    request<Conversation>(`${C}${id}/members/${userId}/`, { method: 'PATCH', body: json({ role }) }),
  removeMember: (id: string, userId: string) => request<Conversation>(`${C}${id}/members/${userId}/`, { method: 'DELETE' }),
  markRead: (id: string, message_id?: string) =>
    request<{ conversation_id: string; last_read_message_id: string | null; last_read_at: string; unread_count: number }>(`${C}${id}/read/`, {
      method: 'POST',
      body: json(message_id ? { message_id } : {}),
    }),
  messages: (id: string, params: { before?: string; after?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v && q.append(k, String(v)))
    return request<MessagePage>(`${C}${id}/messages/${q.toString() ? `?${q}` : ''}`)
  },
  send: (id: string, body: SendInput) => request<ChatMessage>(`${C}${id}/messages/`, { method: 'POST', body: json(body) }),
  edit: (messageId: string, body: string) => request<ChatMessage>(`/chat/messages/${messageId}/`, { method: 'PATCH', body: json({ body }) }),
  remove: (messageId: string) => request<ChatMessage>(`/chat/messages/${messageId}/`, { method: 'DELETE' }),
  contacts: () => request<ChatUser[]>('/chat/contacts/'),
  unread: () => request<UnreadSummary>('/chat/unread/'),
}

/** Server → client WebSocket events (backend/apps/chat/consumers.py + services.py). */
export type ChatEvent =
  | ({ type: 'ready'; user_id: string } & UnreadSummary)
  | { type: 'message.new' | 'message.updated' | 'message.deleted'; conversation_id: string; message: ChatMessage; message_id?: string }
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'conversation.removed'; conversation_id: string }
  | { type: 'read'; conversation_id: string; user_id: string; message_id: string; read_at: string }
  | { type: 'typing'; conversation_id: string; user_id: string; name: string; is_typing: boolean }
  | { type: 'ack'; client_id: string | null; message: ChatMessage }
  | { type: 'read.ack'; conversation_id: string; last_read_message_id: string | null; last_read_at: string; unread_count: number }
  | { type: 'error'; code: string; error: string; request_type?: string; client_id?: string | null; conversation_id?: string | null }
  | { type: 'pong' }

export const EDIT_WINDOW_MS = 15 * 60 * 1000
export const CHAT_KEY = ['chat'] as const
export const CONVERSATIONS_KEY = ['chat', 'conversations'] as const
export const UNREAD_KEY = ['chat', 'unread'] as const
