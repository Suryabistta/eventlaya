import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isModuleDisabled, refreshAccessToken, tokenStore } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { MODULES_KEY, useModules } from '@/lib/modules'
import { CONVERSATIONS_KEY, UNREAD_KEY, chatApi, type ChatEvent, type UnreadSummary } from './api'

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'disabled'

type Listener = (e: ChatEvent | { type: 'socket.reconnected' }) => void

interface ChatContextValue {
  /** Chat is available to this user (module on, organizer or staff). */
  available: boolean
  status: SocketStatus
  unread: number
  /** Send a client event over the socket; false when it isn't open (callers fall back to REST). */
  send: (payload: Record<string, unknown>) => boolean
  subscribe: (fn: Listener) => () => void
}

const ChatContext = createContext<ChatContextValue>({
  available: false,
  status: 'disabled',
  unread: 0,
  send: () => false,
  subscribe: () => () => undefined,
})

export const useChat = () => useContext(ChatContext)

/** Subscribe to realtime chat events for the lifetime of the component. */
export function useChatEvents(handler: Listener) {
  const { subscribe } = useChat()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe])
}

const CHAT_ROLES = ['organizer', 'staff']
const PING_MS = 25_000
const MAX_BACKOFF_MS = 30_000

const socketUrl = (token: string) => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/chat/?token=${encodeURIComponent(token)}`

/**
 * One WebSocket per tab for team chat. Reconnects with exponential backoff, refreshes the access token on
 * 4401, and stops for good on 4403 (chat switched off). Also owns the unread badge count.
 */
export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const modules = useModules()
  const qc = useQueryClient()
  const [forbidden, setForbidden] = useState(false)
  const available = Boolean(user && CHAT_ROLES.includes(user.role) && modules.confirmed('chat') && !forbidden)
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const listeners = useRef(new Set<Listener>())
  const wsRef = useRef<WebSocket | null>(null)

  const emit = useCallback((e: Parameters<Listener>[0]) => listeners.current.forEach((fn) => fn(e)), [])
  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const unreadQuery = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: chatApi.unread,
    enabled: available,
    // Socket events keep it fresh; poll slowly as a safety net (faster while the socket is down).
    refetchInterval: status === 'open' ? 120_000 : 30_000,
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
  })
  useEffect(() => {
    if (isModuleDisabled(unreadQuery.error)) setForbidden(true)
  }, [unreadQuery.error])

  // Coalesce badge refreshes triggered by bursts of events.
  const unreadTimer = useRef<number | undefined>(undefined)
  const refreshUnread = useCallback(() => {
    window.clearTimeout(unreadTimer.current)
    unreadTimer.current = window.setTimeout(() => void qc.invalidateQueries({ queryKey: UNREAD_KEY }), 400)
  }, [qc])

  useEffect(() => {
    if (!available) {
      setStatus('disabled')
      return
    }
    let stopped = false
    let attempt = 0
    let everOpened = false
    let retryTimer: number | undefined
    let pingTimer: number | undefined

    const scheduleReconnect = (delay?: number) => {
      if (stopped) return
      window.clearTimeout(retryTimer)
      const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt)
      attempt += 1
      retryTimer = window.setTimeout(connect, delay ?? base / 2 + Math.random() * (base / 2))
    }

    const connect = () => {
      if (stopped) return
      const token = tokenStore.access
      if (!token) return
      setStatus(everOpened ? 'reconnecting' : 'connecting')
      const ws = new WebSocket(socketUrl(token))
      wsRef.current = ws

      ws.onmessage = (msg) => {
        let data: ChatEvent
        try {
          data = JSON.parse(msg.data)
        } catch {
          return
        }
        if (data.type === 'ready') {
          attempt = 0
          setStatus('open')
          const { unread, unread_conversations, unread_including_muted } = data
          qc.setQueryData<UnreadSummary>(UNREAD_KEY, { unread, unread_conversations, unread_including_muted })
          if (everOpened) {
            // Missed events while offline: reload the list; open threads catch up with ?after=
            void qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
            emit({ type: 'socket.reconnected' })
          }
          everOpened = true
          window.clearInterval(pingTimer)
          pingTimer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), PING_MS)
          return
        }
        if (data.type === 'pong') return
        if (['message.new', 'message.deleted', 'read.ack', 'conversation.updated', 'conversation.removed'].includes(data.type)) refreshUnread()
        if (data.type === 'read' && data.user_id === user?.id) refreshUnread()
        emit(data)
      }

      ws.onclose = async (ev) => {
        window.clearInterval(pingTimer)
        if (wsRef.current === ws) wsRef.current = null
        if (stopped) return
        if (ev.code === 4403) {
          // Chat switched off for this account: stop and let the nav hide it.
          setStatus('disabled')
          setForbidden(true)
          void qc.invalidateQueries({ queryKey: MODULES_KEY })
          return
        }
        setStatus('reconnecting')
        if (ev.code === 4401) {
          const ok = await refreshAccessToken()
          if (stopped) return
          if (ok) {
            scheduleReconnect(200)
            return
          }
        }
        scheduleReconnect()
      }
    }

    connect()

    const wake = () => {
      if (stopped || wsRef.current) return
      attempt = 0
      scheduleReconnect(100)
    }
    const onVisible = () => document.visibilityState === 'visible' && wake()
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pingTimer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', onVisible)
      const ws = wsRef.current
      wsRef.current = null
      ws?.close(1000)
    }
    // Reconnect only when the person or availability changes (tokens refresh in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, user?.id])

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(payload))
    return true
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({ available, status: available ? status : 'disabled', unread: available ? (unreadQuery.data?.unread ?? 0) : 0, send, subscribe }),
    [available, status, unreadQuery.data?.unread, send, subscribe],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
