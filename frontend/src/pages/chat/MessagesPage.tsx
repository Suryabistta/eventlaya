import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, MessageCircle, PenSquare, Search, WifiOff } from 'lucide-react'
import { isModuleDisabled } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { useChat, useChatEvents } from '@/lib/chat/socket'
import { useModules } from '@/lib/modules'
import { CONVERSATIONS_KEY, chatApi, type Conversation } from '@/lib/chat/api'
import { Button, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ConversationAvatar, listTime, preview } from './shared'
import { Thread, conversationKey } from './Thread'
import { InfoDrawer, NewChatModal } from './Dialogs'

const sortList = (list: Conversation[]) => list.slice().sort((a, b) => (b.last_message_at || b.created_at).localeCompare(a.last_message_at || a.created_at))

/**
 * Team chat: conversation list + thread side by side from md up, one pane at a time on phones
 * (/app/messages shows the list, /app/messages/:id the thread).
 */
export const MessagesPage: React.FC = () => {
  const { id: openId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const chat = useChat()
  const toast = useToast()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [composing, setComposing] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const { data: conversations = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: chatApi.conversations,
    enabled: chat.available,
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
    // The socket keeps the list current; poll only while it's down.
    refetchInterval: chat.status === 'open' ? false : 30_000,
  })

  const open = conversations.find((c) => c.id === openId) ?? null
  // Deep link to a chat that isn't in the list yet (e.g. just created elsewhere)
  const { data: fetchedOpen, error: openError } = useQuery({
    queryKey: conversationKey(openId ?? ''),
    queryFn: () => chatApi.conversation(openId!),
    enabled: Boolean(openId && chat.available && !isLoading && !open),
    retry: false,
  })
  const current = open ?? fetchedOpen ?? null

  useChatEvents((e) => {
    switch (e.type) {
      case 'message.new': {
        const known = qc.getQueryData<Conversation[]>(CONVERSATIONS_KEY)?.some((c) => c.id === e.conversation_id)
        if (!known) {
          void qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
          return
        }
        const fromOther = e.message.sender?.id !== user?.id
        const viewing = e.conversation_id === openId && document.visibilityState === 'visible'
        qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) =>
          list &&
          sortList(
            list.map((c) =>
              c.id === e.conversation_id
                ? { ...c, last_message: e.message, last_message_at: e.message.created_at, unread_count: fromOther && !viewing ? c.unread_count + 1 : c.unread_count }
                : c,
            ),
          ),
        )
        return
      }
      case 'message.updated':
      case 'message.deleted':
        qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) =>
          list?.map((c) => (c.id === e.conversation_id && c.last_message?.id === e.message.id ? { ...c, last_message: e.message } : c)),
        )
        return
      case 'conversation.updated': {
        const c = e.conversation
        qc.setQueryData(conversationKey(c.id), c)
        qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => (list ? sortList([c, ...list.filter((x) => x.id !== c.id)]) : list))
        return
      }
      case 'conversation.removed':
        qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.filter((c) => c.id !== e.conversation_id))
        qc.removeQueries({ queryKey: conversationKey(e.conversation_id) })
        if (e.conversation_id === openId) {
          setInfoOpen(false)
          toast.info('You’re no longer in that chat')
          navigate('/app/messages', { replace: true })
        }
        return
      case 'read':
        if (e.user_id === user?.id) qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.map((c) => (c.id === e.conversation_id ? { ...c, unread_count: 0 } : c)))
        return
      case 'read.ack':
        qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.map((c) => (c.id === e.conversation_id ? { ...c, unread_count: e.unread_count } : c)))
        return
    }
  })

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(s) || c.event?.title.toLowerCase().includes(s) || c.other_member?.email.toLowerCase().includes(s))
  }, [conversations, q])

  const modulesLoaded = useModules().loaded
  if (!user) return null
  if (!modulesLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      </div>
    )
  }

  if (!chat.available || isModuleDisabled(error)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <EmptyState icon={<MessageCircle className="h-6 w-6" />} title="Team chat is turned off" description="Chat isn’t available for your account right now." />
      </div>
    )
  }

  const goTo = (c: Conversation) => navigate(`/app/messages/${c.id}`)

  return (
    <div className="flex h-[calc(100dvh-3.5rem-4.5rem-env(safe-area-inset-bottom))] min-h-[420px] overflow-hidden border-ink-200 bg-white lg:h-[calc(100dvh-4rem)]">
      {/* Conversation list */}
      <section
        aria-label="Conversations"
        className={cn('flex min-h-0 w-full flex-col border-ink-200 md:w-80 md:shrink-0 md:border-r lg:w-96', openId && 'hidden md:flex')}
      >
        <div className="shrink-0 space-y-3 border-b border-ink-100 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-ink-900">Messages</h1>
            <Button size="sm" onClick={() => setComposing(true)} icon={<PenSquare className="h-4 w-4" aria-hidden />}>
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="h-10 w-full rounded-[10px] border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {chat.status === 'reconnecting' && !current && (
            <p className="flex items-center gap-1.5 text-xs text-marigold-800" role="status">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Live updates paused. Reconnecting…
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isError ? (
            <div className="p-4">
              <ErrorState message={error?.message} onRetry={refetch} />
            </div>
          ) : isLoading ? (
            <div className="space-y-1 p-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageCircle className="h-6 w-6" />}
              title="No chats yet"
              description={user.role === 'organizer' ? 'Message your gate staff and team, or start a group for a crew.' : 'Message your organizer or teammates.'}
              action={
                <Button size="sm" onClick={() => setComposing(true)}>
                  Start a chat
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">No chats match “{q}”.</p>
          ) : (
            <ul className="p-2">
              {filtered.map((c) => (
                <li key={c.id}>
                  <ConversationRow conversation={c} active={c.id === openId} meId={user.id} onClick={() => goTo(c)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Thread */}
      <div className={cn('min-h-0 min-w-0 flex-1', openId ? 'flex' : 'hidden md:flex')}>
        {current ? (
          <Thread key={current.id} conversation={current} me={user} onBack={() => navigate('/app/messages')} onOpenInfo={() => setInfoOpen(true)} />
        ) : openId && (openError || (!isLoading && !fetchedOpen && !open)) ? (
          <div className="flex flex-1 items-center justify-center bg-ink-50 p-6">
            <EmptyState
              icon={<MessageCircle className="h-6 w-6" />}
              title="This chat isn’t available"
              description="You may have left it, or been removed."
              action={
                <Button variant="secondary" size="sm" onClick={() => navigate('/app/messages')}>
                  Back to messages
                </Button>
              }
            />
          </div>
        ) : openId ? (
          <div className="flex flex-1 items-center justify-center bg-ink-50">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" role="status" aria-label="Loading chat" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-ink-50 p-6">
            <EmptyState
              icon={<MessageCircle className="h-6 w-6" />}
              title="Pick a chat"
              description="Choose a conversation on the left, or start a new one."
              action={
                <Button size="sm" variant="secondary" onClick={() => setComposing(true)} icon={<PenSquare className="h-4 w-4" aria-hidden />}>
                  New message
                </Button>
              }
            />
          </div>
        )}
      </div>

      <NewChatModal open={composing} onClose={() => setComposing(false)} me={user} onOpen={goTo} />
      {current && <InfoDrawer conversation={current} me={user} open={infoOpen} onClose={() => setInfoOpen(false)} onLeft={() => {
        setInfoOpen(false)
        navigate('/app/messages', { replace: true })
      }} />}
    </div>
  )
}

const ConversationRow: React.FC<{ conversation: Conversation; active: boolean; meId: string; onClick: () => void }> = ({ conversation: c, active, meId, onClick }) => {
  const unread = c.unread_count > 0
  const last = c.last_message
  const who = last && c.kind === 'group' && last.sender ? (last.sender.id === meId ? 'You: ' : `${last.sender.name.split(' ')[0]}: `) : last?.sender?.id === meId ? 'You: ' : ''
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors', active ? 'bg-brand-50' : 'hover:bg-ink-50')}
    >
      <ConversationAvatar conversation={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[15px]', unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-800')}>{c.title}</span>
          {c.is_event_crew && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-700">Crew</span>}
          {c.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-label="Muted" />}
          <span className={cn('ml-auto shrink-0 text-xs tabular', unread && !c.muted ? 'font-semibold text-brand-700' : 'text-ink-400')}>{listTime(c.last_message_at || c.created_at)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'text-ink-800' : 'text-ink-500', last?.is_deleted && 'italic')}>
            {last ? `${who}${preview(last)}` : c.kind === 'group' ? `${c.member_count} members` : 'No messages yet'}
          </span>
          {unread && (
            <span className={cn('h-5 min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular', c.muted ? 'bg-ink-200 text-ink-600' : 'bg-brand-600 text-white')}>
              {c.unread_count > 99 ? '99+' : c.unread_count}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

export default MessagesPage
