import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Event } from '@/services/api'
import { defaultEvent } from '@/lib/phase'

const STORAGE_KEY = 'eventlaya:current-event'

interface EventContextValue {
  events: Event[]
  currentEvent: Event | undefined
  setCurrentEventId: (id: string) => void
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

const EventContext = createContext<EventContextValue | null>(null)

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** The event the organizer is working on. Shared by every page in the app shell. */
export const CurrentEventProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: api.getEvents,
  })
  const [selectedId, setSelectedId] = useState<string | null>(readStored)

  // Default: the stored choice, else a live event, else the next upcoming one, else the most recent
  const currentEvent = useMemo(() => {
    if (!events.length) return undefined
    const stored = events.find((e) => e.id === selectedId)
    if (stored) return stored
    return defaultEvent(events)
  }, [events, selectedId])

  useEffect(() => {
    if (!currentEvent) return
    try {
      localStorage.setItem(STORAGE_KEY, currentEvent.id)
    } catch {
      /* storage unavailable */
    }
  }, [currentEvent])

  const value = useMemo<EventContextValue>(
    () => ({
      events,
      currentEvent,
      setCurrentEventId: setSelectedId,
      isLoading,
      isError,
      error: error as Error | null,
      refetch: () => void refetch(),
    }),
    [events, currentEvent, isLoading, isError, error, refetch],
  )

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export function useCurrentEvent() {
  const ctx = useContext(EventContext)
  if (!ctx) throw new Error('useCurrentEvent must be used inside <CurrentEventProvider>')
  return ctx
}
