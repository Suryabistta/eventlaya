import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowDown, ArrowLeft, BellOff, Copy, CornerUpLeft, ImagePlus, Info, Loader2, MoreHorizontal, Pencil, RotateCw, SendHorizontal, Trash2, X } from 'lucide-react'
import type { AuthUser } from '@/services/api'
import { uploadImage, useToast } from '@/components/ui'
import { useChat, useChatEvents } from '@/lib/chat/socket'
import { CONVERSATIONS_KEY, EDIT_WINDOW_MS, chatApi, type ChatMessage, type ChatUser, type Conversation } from '@/lib/chat/api'
import { cn } from '@/lib/utils'
import { ConversationAvatar, PersonAvatar, clockTime, dayKey, dayLabel, newClientId, preview } from './shared'

const PAGE_SIZE = 30
const ACK_TIMEOUT_MS = 8000
const TYPING_SEND_EVERY = 3000
const TYPING_IDLE = 4000
const TYPING_SHOW_FOR = 6000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const conversationKey = (id: string) => ['chat', 'conversation', id] as const

const byTime = (a: ChatMessage, b: ChatMessage) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)

/** Insert or replace a message (matched by id, or by client_id for our own optimistic copies). */
function upsert(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id || (m.client_id && x.client_id === m.client_id && (x.pending || x.failed)))
  if (i >= 0) {
    const next = list.slice()
    next[i] = m
    return next
  }
  const next = [...list, m]
  // Keep optimistic messages last; real ones in server order.
  return next.sort((a, b) => Number(Boolean(a.pending || a.failed)) - Number(Boolean(b.pending || b.failed)) || byTime(a, b))
}

function mergeMany(list: ChatMessage[], incoming: ChatMessage[]) {
  return incoming.reduce(upsert, list)
}

interface ThreadProps {
  conversation: Conversation
  me: AuthUser
  onBack: () => void
  onOpenInfo: () => void
}

export const Thread: React.FC<ThreadProps> = ({ conversation: conv, me, onBack, onOpenInfo }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const chat = useChat()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<{ url: string; name: string; preview: string } | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const restoreHeight = useRef<number | null>(null)
  const stickToBottom = useRef(true)
  const ackTimers = useRef(new Map<string, number>())
  const lastMarked = useRef<string | null>(null)
  const typingSentAt = useRef(0)
  const typingIdle = useRef<number | undefined>(undefined)

  // Members (for read receipts and names): the detail endpoint, kept fresh by conversation.updated / read events.
  const { data: detail } = useQuery({ queryKey: conversationKey(conv.id), queryFn: () => chatApi.conversation(conv.id) })
  const members = detail?.members ?? conv.members ?? []
  const isGroup = conv.kind === 'group'

  /* ---------------- loading ---------------- */

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setLoading(true)
    setLoadError('')
    setReplyTo(null)
    setEditing(null)
    setDraft('')
    setAttachment(null)
    setTyping({})
    lastMarked.current = null
    stickToBottom.current = true
    chatApi
      .messages(conv.id, { limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        setMessages(page.results.slice().reverse())
        setHasMore(page.has_more)
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Couldn’t load messages.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [conv.id])

  useEffect(() => () => ackTimers.current.forEach((t) => window.clearTimeout(t)), [])

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((m) => !m.pending && !m.failed)
    if (!oldest || loadingOlder || !hasMore) return
    setLoadingOlder(true)
    try {
      const page = await chatApi.messages(conv.id, { before: oldest.id, limit: PAGE_SIZE })
      restoreHeight.current = scrollRef.current?.scrollHeight ?? null
      stickToBottom.current = false
      setMessages((list) => mergeMany(list, page.results))
      setHasMore(page.has_more)
    } catch (e) {
      toast.error('Couldn’t load older messages', e instanceof Error ? e.message : undefined)
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, loadingOlder, hasMore, conv.id, toast])

  // Infinite scroll upwards
  useEffect(() => {
    const root = scrollRef.current
    const target = topRef.current
    if (!root || !target || !hasMore) return
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlder(), { root, rootMargin: '200px 0px 0px 0px' })
    io.observe(target)
    return () => io.disconnect()
  }, [hasMore, loadOlder])

  // Keep the reading position when older messages are prepended; otherwise follow new messages.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (restoreHeight.current !== null) {
      el.scrollTop += el.scrollHeight - restoreHeight.current
      restoreHeight.current = null
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    stickToBottom.current = near
    setAtBottom(near)
  }
  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  /* ---------------- realtime ---------------- */

  const catchUp = useCallback(async () => {
    let after = [...messages].reverse().find((m) => !m.pending && !m.failed)?.id
    try {
      for (let i = 0; i < 10; i++) {
        const page = await chatApi.messages(conv.id, after ? { after, limit: 100 } : { limit: PAGE_SIZE })
        setMessages((list) => mergeMany(list, page.order === 'newest_first' ? page.results.slice().reverse() : page.results))
        if (!after || !page.has_more || !page.next_after) break
        after = page.next_after
      }
      void qc.invalidateQueries({ queryKey: conversationKey(conv.id) })
    } catch {
      /* the next reconnect tries again */
    }
  }, [messages, conv.id, qc])

  /** Our own message reached the server: show it as the chat's latest in the list. */
  const bumpList = (m: ChatMessage) =>
    qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) =>
      list
        ?.map((c) => (c.id === m.conversation_id && (!c.last_message_at || c.last_message_at <= m.created_at) ? { ...c, last_message: m, last_message_at: m.created_at } : c))
        .sort((a, b) => (b.last_message_at || b.created_at).localeCompare(a.last_message_at || a.created_at)),
    )

  const settle = (clientId: string | null | undefined) => {
    if (!clientId) return
    const t = ackTimers.current.get(clientId)
    if (t) window.clearTimeout(t)
    ackTimers.current.delete(clientId)
  }

  useChatEvents((e) => {
    switch (e.type) {
      case 'socket.reconnected':
        void catchUp()
        return
      case 'message.new':
      case 'message.updated':
      case 'message.deleted':
        if (e.conversation_id !== conv.id) return
        settle(e.message.client_id)
        if (e.message.sender?.id === me.id || stickToBottom.current) stickToBottom.current = true
        setMessages((list) => upsert(list, e.message))
        if (e.type === 'message.new' && e.message.sender) {
          const uid = e.message.sender.id
          setTyping(({ [uid]: _, ...rest }) => rest)
        }
        return
      case 'ack':
        if (e.message.conversation_id !== conv.id) return
        settle(e.client_id)
        setMessages((list) => upsert(list, e.message))
        bumpList(e.message)
        return
      case 'error':
        if (e.request_type === 'message.send' && e.conversation_id === conv.id && e.client_id) {
          settle(e.client_id)
          setMessages((list) => list.map((m) => (m.client_id === e.client_id ? { ...m, pending: false, failed: true } : m)))
          toast.error('Message not sent', e.error)
        }
        return
      case 'typing':
        if (e.conversation_id !== conv.id || e.user_id === me.id) return
        setTyping((t) => {
          const { [e.user_id]: _, ...rest } = t
          return e.is_typing ? { ...rest, [e.user_id]: { name: e.name, until: Date.now() + TYPING_SHOW_FOR } } : rest
        })
        return
      case 'read':
        if (e.conversation_id !== conv.id) return
        qc.setQueryData<Conversation>(conversationKey(conv.id), (c) =>
          c?.members
            ? { ...c, members: c.members.map((m) => (m.user.id === e.user_id ? { ...m, last_read_at: e.read_at, last_read_message_id: e.message_id } : m)) }
            : c,
        )
        return
    }
  })

  // Typing indicators expire on their own (a dropped "stopped typing" event shouldn't stick)
  useEffect(() => {
    if (!Object.keys(typing).length) return
    const t = window.setInterval(() => {
      const now = Date.now()
      setTyping((cur) => Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now)))
    }, 2000)
    return () => window.clearInterval(t)
  }, [typing])

  /* ---------------- read position ---------------- */

  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    const latest = [...messages].reverse().find((m) => !m.pending && !m.failed)
    if (!latest || latest.id === lastMarked.current) return
    lastMarked.current = latest.id
    const zero = () =>
      qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.map((c) => (c.id === conv.id ? { ...c, unread_count: 0, last_read_message_id: latest.id } : c)))
    zero()
    if (!chat.send({ type: 'read', conversation_id: conv.id, message_id: latest.id })) {
      chatApi.markRead(conv.id, latest.id).then(() => void qc.invalidateQueries({ queryKey: ['chat', 'unread'] })).catch(() => (lastMarked.current = null))
    }
  }, [messages, conv.id, chat, qc])

  useEffect(() => {
    if (!loading) markRead()
  }, [loading, markRead])
  useEffect(() => {
    const onVis = () => markRead()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [markRead])

  /* ---------------- sending ---------------- */

  const sendTyping = (isTyping: boolean) => {
    chat.send({ type: 'typing', conversation_id: conv.id, is_typing: isTyping })
  }

  const onDraftChange = (v: string) => {
    setDraft(v)
    if (editing || conv.read_only) return
    const now = Date.now()
    if (v && now - typingSentAt.current > TYPING_SEND_EVERY) {
      typingSentAt.current = now
      sendTyping(true)
    }
    window.clearTimeout(typingIdle.current)
    typingIdle.current = window.setTimeout(() => {
      if (typingSentAt.current) sendTyping(false)
      typingSentAt.current = 0
    }, TYPING_IDLE)
  }

  const restSend = (clientId: string, payload: { body: string; attachment: { url: string; name: string } | null; reply_to: string | null }) =>
    chatApi
      .send(conv.id, { ...payload, client_id: clientId })
      .then((m) => {
        settle(clientId)
        setMessages((list) => upsert(list, m))
        bumpList(m)
      })
      .catch((e) => {
        settle(clientId)
        setMessages((list) => list.map((m) => (m.client_id === clientId && m.pending ? { ...m, pending: false, failed: true } : m)))
        toast.error('Message not sent', e instanceof Error ? e.message : 'Check your connection and try again.')
      })

  const dispatch = (clientId: string, payload: { body: string; attachment: { url: string; name: string } | null; reply_to: string | null }) => {
    const viaSocket = chat.send({ type: 'message.send', conversation_id: conv.id, client_id: clientId, ...payload })
    if (!viaSocket) {
      void restSend(clientId, payload)
      return
    }
    // No ack in time: send over REST too. The client_id makes it idempotent.
    ackTimers.current.set(
      clientId,
      window.setTimeout(() => {
        ackTimers.current.delete(clientId)
        void restSend(clientId, payload)
      }, ACK_TIMEOUT_MS),
    )
  }

  const submit = async () => {
    const body = draft.trim()
    if (editing) {
      if (!body && !editing.attachment) return
      const target = editing
      setEditing(null)
      setDraft('')
      if (body === target.body) return
      try {
        const saved = await chatApi.edit(target.id, body)
        setMessages((list) => upsert(list, saved))
      } catch (e) {
        toast.error('Couldn’t edit the message', e instanceof Error ? e.message : undefined)
      }
      return
    }
    if ((!body && !attachment) || uploading !== null) return
    const clientId = newClientId()
    const sender: ChatUser = { id: me.id, name: me.full_name || me.username, email: me.email, role: me.role, avatar: me.avatar ?? null }
    const optimistic: ChatMessage = {
      id: `tmp-${clientId}`,
      conversation_id: conv.id,
      sender,
      body,
      attachment: attachment ? { url: attachment.preview, name: attachment.name, mime: 'image/*', size: null } : null,
      reply_to: replyTo
        ? { id: replyTo.id, sender_id: replyTo.sender?.id ?? null, sender_name: replyTo.sender?.name ?? null, body: replyTo.body.slice(0, 200), has_attachment: Boolean(replyTo.attachment), is_deleted: replyTo.is_deleted }
        : null,
      client_id: clientId,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      is_deleted: false,
      pending: true,
    }
    const payload = { body, attachment: attachment ? { url: attachment.url, name: attachment.name } : null, reply_to: replyTo?.id ?? null }
    stickToBottom.current = true
    setMessages((list) => upsert(list, optimistic))
    setDraft('')
    setReplyTo(null)
    setAttachment(null)
    window.clearTimeout(typingIdle.current)
    if (typingSentAt.current) sendTyping(false)
    typingSentAt.current = 0
    dispatch(clientId, payload)
    inputRef.current?.focus()
  }

  const retry = (m: ChatMessage) => {
    if (!m.client_id) return
    setMessages((list) => list.map((x) => (x.client_id === m.client_id ? { ...x, failed: false, pending: true } : x)))
    void restSend(m.client_id, {
      body: m.body,
      attachment: m.attachment ? { url: new URL(m.attachment.url, window.location.origin).pathname, name: m.attachment.name } : null,
      reply_to: m.reply_to?.id ?? null,
    })
  }

  const discard = (m: ChatMessage) => setMessages((list) => list.filter((x) => x !== m))

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return toast.error('Couldn’t attach that', 'Send a JPG, PNG, WebP or GIF image.')
    if (file.size > 5 * 1024 * 1024) return toast.error('Couldn’t attach that', 'Images can be up to 5 MB.')
    setUploading(0)
    try {
      const url = await uploadImage(file, 'chat', setUploading)
      setAttachment({ url, name: file.name, preview: url })
      inputRef.current?.focus()
    } catch (e) {
      toast.error('Upload failed', e instanceof Error ? e.message : undefined)
    } finally {
      setUploading(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (m: ChatMessage) => {
    setMenuFor(null)
    if (!(await toast.confirm({ title: 'Delete this message?', description: 'Everyone in the chat will see “Message deleted”.', confirmLabel: 'Delete', danger: true }))) return
    try {
      const saved = await chatApi.remove(m.id)
      setMessages((list) => upsert(list, saved))
    } catch (e) {
      toast.error('Couldn’t delete the message', e instanceof Error ? e.message : undefined)
    }
  }

  const startEdit = (m: ChatMessage) => {
    setMenuFor(null)
    setReplyTo(null)
    setEditing(m)
    setDraft(m.body)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const startReply = (m: ChatMessage) => {
    setMenuFor(null)
    setEditing(null)
    setReplyTo(m)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /* ---------------- derived ---------------- */

  const myRole = conv.my_role
  const others = members.filter((m) => m.user.id !== me.id)
  const lastMine = [...messages].reverse().find((m) => m.sender?.id === me.id && !m.pending && !m.failed)
  const lastOverall = [...messages].reverse().find((m) => !m.pending && !m.failed)
  const seenBy = lastMine ? others.filter((m) => m.last_read_at && new Date(m.last_read_at).getTime() >= new Date(lastMine.created_at).getTime()) : []
  const receipt =
    lastMine && lastOverall?.id === lastMine.id && seenBy.length
      ? isGroup
        ? seenBy.length >= others.length
          ? 'Seen by everyone'
          : `Seen by ${seenBy.length}`
        : 'Seen'
      : null
  const typingNames = Object.values(typing).map((t) => t.name.split(' ')[0])

  const rows = useMemo(() => {
    const out: ({ type: 'day'; key: string; label: string } | { type: 'msg'; m: ChatMessage; first: boolean; last: boolean })[] = []
    messages.forEach((m, i) => {
      const prev = messages[i - 1]
      const next = messages[i + 1]
      if (!prev || dayKey(prev.created_at) !== dayKey(m.created_at)) out.push({ type: 'day', key: `d-${dayKey(m.created_at)}`, label: dayLabel(m.created_at) })
      const sameRun = (a?: ChatMessage, b?: ChatMessage) =>
        Boolean(a && b && a.sender?.id === b.sender?.id && dayKey(a.created_at) === dayKey(b.created_at) && Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) < 5 * 60_000)
      out.push({ type: 'msg', m, first: !sameRun(prev, m), last: !sameRun(m, next) })
    })
    return out
  }, [messages])

  const subtitle =
    conv.kind === 'direct'
      ? conv.read_only
        ? 'No longer on the team'
        : conv.other_member?.email
      : `${conv.member_count} member${conv.member_count === 1 ? '' : 's'}${conv.event ? ` · ${conv.event.title}` : ''}`

  /* ---------------- render ---------------- */

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-ink-50" aria-label={`Chat with ${conv.title}`}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-3 sm:px-4">
        <button type="button" onClick={onBack} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-600 hover:bg-ink-100 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={onOpenInfo} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-ink-50">
          <ConversationAvatar conversation={conv} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-ink-900">{conv.title}</span>
              {conv.is_event_crew && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Crew</span>}
              {conv.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-label="Muted" />}
            </span>
            <span className="block truncate text-xs text-ink-500">
              {typingNames.length ? <span className="font-medium text-brand-700">{typingNames.join(', ')} typing…</span> : subtitle}
            </span>
          </span>
        </button>
        <button type="button" onClick={onOpenInfo} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label={isGroup ? 'Group info' : 'Chat info'}>
          <Info className="h-5 w-5" />
        </button>
      </header>

      {chat.status === 'reconnecting' && (
        <p className="shrink-0 border-b border-marigold-100 bg-marigold-50 px-4 py-1.5 text-center text-xs font-medium text-marigold-800" role="status">
          Reconnecting… messages still send, live updates are paused.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-6" onClick={() => setMenuFor(null)}>
          {loading ? (
            <div className="flex h-full items-center justify-center" role="status" aria-label="Loading messages">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-ink-600">
              <AlertCircle className="h-6 w-6 text-red-500" aria-hidden />
              {loadError}
            </div>
          ) : (
            <>
              <div ref={topRef} aria-hidden className="h-px" />
              {hasMore ? (
                <div className="flex justify-center py-2">
                  <button type="button" onClick={() => void loadOlder()} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-600 shadow-2xs hover:text-ink-900">
                    {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              ) : (
                messages.length > 0 && <p className="py-3 text-center text-xs text-ink-400">Start of the conversation</p>
              )}
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
                  <ConversationAvatar conversation={conv} size="lg" />
                  <p className="font-semibold text-ink-900">{conv.title}</p>
                  <p className="max-w-xs text-sm text-ink-500">No messages yet. Say hello{isGroup ? ' to the group' : ''}.</p>
                </div>
              )}
              <ol className="space-y-0.5" aria-live="polite" aria-relevant="additions">
                {rows.map((r) =>
                  r.type === 'day' ? (
                    <li key={r.key} className="sticky top-0 z-[1] flex justify-center py-3">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-ink-500 shadow-2xs backdrop-blur">{r.label}</span>
                    </li>
                  ) : (
                    <MessageRow
                      key={r.m.client_id && (r.m.pending || r.m.failed) ? r.m.client_id : r.m.id}
                      m={r.m}
                      mine={r.m.sender?.id === me.id}
                      first={r.first}
                      last={r.last}
                      showName={isGroup}
                      menuOpen={menuFor === r.m.id}
                      onMenu={(open) => setMenuFor(open ? r.m.id : null)}
                      canEdit={r.m.sender?.id === me.id && !r.m.is_deleted && Boolean(r.m.body) && Date.now() - new Date(r.m.created_at).getTime() < EDIT_WINDOW_MS}
                      canDelete={!r.m.is_deleted && (r.m.sender?.id === me.id || (isGroup && myRole === 'admin'))}
                      canReply={!conv.read_only && !r.m.is_deleted}
                      onReply={() => startReply(r.m)}
                      onEdit={() => startEdit(r.m)}
                      onDelete={() => void remove(r.m)}
                      onRetry={() => retry(r.m)}
                      onDiscard={() => discard(r.m)}
                      receipt={lastMine && r.m.id === lastMine.id ? receipt : null}
                    />
                  ),
                )}
              </ol>
              {typingNames.length > 0 && (
                <p className="mt-2 flex items-center gap-2 px-1 text-xs text-ink-500" aria-live="polite">
                  <span className="flex gap-0.5" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${i * 120}ms` }} />
                    ))}
                  </span>
                  {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(', ')} are typing…`}
                </p>
              )}
            </>
          )}
        </div>
        {!atBottom && !loading && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 shadow-pop hover:text-ink-900"
            aria-label="Jump to latest messages"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        )}
      </div>

      {conv.read_only ? (
        <p className="shrink-0 border-t border-ink-200 bg-white px-4 py-4 text-center text-sm text-ink-500">
          {conv.title} is no longer on the team, so you can’t send messages here.
        </p>
      ) : (
        <form
          className="shrink-0 border-t border-ink-200 bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-4 lg:pb-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {(replyTo || editing) && (
            <div className="mb-2 flex items-start gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm">
              {editing ? <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> : <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-700">{editing ? 'Editing message' : `Replying to ${replyTo!.sender?.id === me.id ? 'yourself' : replyTo!.sender?.name}`}</p>
                <p className="truncate text-ink-600">{preview(editing ?? replyTo)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editing) setDraft('')
                  setEditing(null)
                  setReplyTo(null)
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-200"
                aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {(attachment || uploading !== null) && (
            <div className="mb-2 flex items-center gap-3">
              <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-ink-200 bg-ink-100">
                {attachment ? <img src={attachment.preview} alt="" className="h-full w-full object-cover" /> : (
                  <span className="flex h-full items-center justify-center text-xs font-medium text-ink-600 tabular">{uploading}%</span>
                )}
              </div>
              {attachment && (
                <button type="button" onClick={() => setAttachment(null)} className="text-sm font-medium text-ink-600 hover:text-ink-900">
                  Remove photo
                </button>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            {!editing && (
              <>
                <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => void pickImage(e.target.files?.[0])} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading !== null}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
                  aria-label="Attach a photo"
                >
                  {uploading !== null ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                </button>
              </>
            )}
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={4000}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submit()
                }
                if (e.key === 'Escape' && (editing || replyTo)) {
                  if (editing) setDraft('')
                  setEditing(null)
                  setReplyTo(null)
                }
              }}
              placeholder={editing ? 'Edit your message' : 'Write a message'}
              className="max-h-36 min-h-10 flex-1 resize-none rounded-[20px] border border-ink-200 bg-ink-50 px-4 py-2 text-[15px] leading-6 text-ink-900 placeholder:text-ink-400 [field-sizing:content] focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              type="submit"
              disabled={editing ? !draft.trim() && !editing.attachment : (!draft.trim() && !attachment) || uploading !== null}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-xs transition-colors hover:bg-brand-700 disabled:bg-ink-200 disabled:text-ink-400"
              aria-label={editing ? 'Save edit' : 'Send'}
            >
              <SendHorizontal className="h-[18px] w-[18px]" />
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

interface RowProps {
  m: ChatMessage
  mine: boolean
  first: boolean
  last: boolean
  showName: boolean
  menuOpen: boolean
  onMenu: (open: boolean) => void
  canEdit: boolean
  canDelete: boolean
  canReply: boolean
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onRetry: () => void
  onDiscard: () => void
  receipt: string | null
}

const MessageRow: React.FC<RowProps> = ({ m, mine, first, last, showName, menuOpen, onMenu, canEdit, canDelete, canReply, onReply, onEdit, onDelete, onRetry, onDiscard, receipt }) => {
  const toast = useToast()
  const hasMenu = !m.pending && !m.failed && !m.is_deleted
  return (
    <li className={cn('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start', first ? 'mt-3' : 'mt-0.5')}>
      {!mine && <div className="w-8 shrink-0">{last && m.sender && <PersonAvatar user={m.sender} size="sm" />}</div>}
      <div className={cn('flex max-w-[82%] flex-col sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        {!mine && showName && first && m.sender && <p className="mb-0.5 ml-3 text-xs font-semibold text-ink-600">{m.sender.name}</p>}
        <div className={cn('relative flex items-center gap-1', mine ? 'flex-row-reverse' : 'flex-row')}>
          <div
            className={cn(
              'min-w-0 overflow-hidden rounded-[18px] text-[15px] leading-snug',
              m.is_deleted
                ? 'border border-dashed border-ink-300 bg-transparent px-3.5 py-2 italic text-ink-500'
                : mine
                  ? 'bg-brand-600 text-white'
                  : 'border border-ink-200 bg-white text-ink-900',
              !m.is_deleted && mine && !last && 'rounded-br-md',
              !m.is_deleted && !mine && !last && 'rounded-bl-md',
              m.pending && 'opacity-70',
              m.failed && 'bg-red-600',
            )}
          >
            {m.is_deleted ? (
              'Message deleted'
            ) : (
              <>
                {m.reply_to && (
                  <div className={cn('mx-1.5 mt-1.5 rounded-xl border-l-[3px] px-2.5 py-1.5 text-xs', mine ? 'border-white/60 bg-white/15 text-white/90' : 'border-brand-400 bg-ink-50 text-ink-600')}>
                    <p className="font-semibold">{m.reply_to.sender_name ?? 'Someone'}</p>
                    <p className="line-clamp-2">{m.reply_to.is_deleted ? 'Message deleted' : m.reply_to.body || (m.reply_to.has_attachment ? 'Photo' : '')}</p>
                  </div>
                )}
                {m.attachment && (
                  <a href={m.attachment.url} target="_blank" rel="noopener noreferrer" className="block p-1">
                    <img src={m.attachment.url} alt={m.attachment.name || 'Photo'} loading="lazy" className="max-h-72 w-auto max-w-full rounded-[14px] object-cover" />
                  </a>
                )}
                {m.body && <p className="whitespace-pre-wrap px-3.5 py-2 [overflow-wrap:anywhere]">{m.body}</p>}
              </>
            )}
          </div>
          {hasMenu && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onMenu(!menuOpen)
                }}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-ink-200 hover:text-ink-700 focus-visible:opacity-100',
                  menuOpen ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
                )}
                aria-label="Message options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  className={cn('absolute bottom-full z-20 mb-1 w-40 animate-pop-in rounded-xl border border-ink-200 bg-white p-1 shadow-pop', mine ? 'right-0' : 'left-0')}
                >
                  {canReply && <MenuItem icon={CornerUpLeft} label="Reply" onClick={onReply} />}
                  {m.body && (
                    <MenuItem
                      icon={Copy}
                      label="Copy text"
                      onClick={() => {
                        onMenu(false)
                        navigator.clipboard?.writeText(m.body).then(() => toast.success('Copied'), () => undefined)
                      }}
                    />
                  )}
                  {canEdit && <MenuItem icon={Pencil} label="Edit" onClick={onEdit} />}
                  {canDelete && <MenuItem icon={Trash2} label="Delete" danger onClick={onDelete} />}
                </div>
              )}
            </div>
          )}
        </div>
        {(last || m.failed || receipt) && (
          <p className={cn('mt-0.5 flex items-center gap-1.5 px-2 text-[11px]', m.failed ? 'text-red-600' : 'text-ink-400')}>
            {m.failed ? (
              <>
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                Not sent.
                <button type="button" onClick={onRetry} className="inline-flex items-center gap-0.5 font-semibold underline">
                  <RotateCw className="h-3 w-3" aria-hidden />
                  Retry
                </button>
                <button type="button" onClick={onDiscard} className="font-semibold underline">
                  Discard
                </button>
              </>
            ) : m.pending ? (
              'Sending…'
            ) : (
              <>
                <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
                {m.edited_at && !m.is_deleted && <span>· edited</span>}
                {receipt && <span className="font-medium text-ink-500">· {receipt}</span>}
              </>
            )}
          </p>
        )}
      </div>
    </li>
  )
}

const MenuItem: React.FC<{ icon: React.ElementType; label: string; onClick: () => void; danger?: boolean }> = ({ icon: Icon, label, onClick, danger }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm', danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-ink-50')}
  >
    <Icon className="h-4 w-4" aria-hidden />
    {label}
  </button>
)
