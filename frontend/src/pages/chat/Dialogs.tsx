import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Check, Crown, LogOut, Pencil, Search, UserMinus, UserPlus, UsersRound, X } from 'lucide-react'
import type { AuthUser } from '@/services/api'
import { CONVERSATIONS_KEY, chatApi, type ChatUser, type Conversation } from '@/lib/chat/api'
import { Button, Input, Modal, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ConversationAvatar, PersonAvatar, roleLabel } from './shared'
import { conversationKey } from './Thread'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

const useContacts = (enabled: boolean) => useQuery({ queryKey: ['chat', 'contacts'], queryFn: chatApi.contacts, enabled, staleTime: 60_000 })

const matches = (u: ChatUser, q: string) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
    <input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
    />
  </div>
)

/** Pick people from the contact list (multi-select). */
const PeoplePicker: React.FC<{ people: ChatUser[]; selected: string[]; onToggle: (id: string) => void; loading?: boolean }> = ({ people, selected, onToggle, loading }) => {
  const [q, setQ] = useState('')
  const shown = people.filter((p) => matches(p, q.trim().toLowerCase()))
  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} label="Search your team" />
      <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-200" aria-label="Team members">
        {loading && <li className="px-3 py-4 text-sm text-ink-500">Loading your team…</li>}
        {!loading && shown.length === 0 && <li className="px-3 py-4 text-sm text-ink-500">{people.length ? 'No one matches that search.' : 'Nobody else to add yet.'}</li>}
        {shown.map((p) => {
          const on = selected.includes(p.id)
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ink-50">
                <input type="checkbox" checked={on} onChange={() => onToggle(p.id)} className="sr-only" />
                <PersonAvatar user={p} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{p.name}</span>
                  <span className="block truncate text-xs text-ink-500">{roleLabel(p.role)}</span>
                </span>
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')} aria-hidden>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export const NewChatModal: React.FC<{ open: boolean; onClose: () => void; me: AuthUser; onOpen: (c: Conversation) => void }> = ({ open, onClose, me, onOpen }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const canGroup = me.role === 'organizer'
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const { data: contacts = [], isLoading, isError, error } = useContacts(open)

  useEffect(() => {
    if (!open) return
    setMode('direct')
    setQ('')
    setTitle('')
    setPicked([])
  }, [open])

  const done = (c: Conversation) => {
    qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => (list ? [c, ...list.filter((x) => x.id !== c.id)] : [c]))
    qc.setQueryData(conversationKey(c.id), c)
    onOpen(c)
    onClose()
  }

  const startDirect = async (u: ChatUser) => {
    setBusy(u.id)
    try {
      done(await chatApi.startDirect(u.id))
    } catch (e) {
      toast.error('Couldn’t start the chat', errText(e))
    } finally {
      setBusy(null)
    }
  }

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !picked.length) return
    setBusy('group')
    try {
      done(await chatApi.createGroup(title.trim(), picked))
      toast.success('Group created')
    } catch (err) {
      toast.error('Couldn’t create the group', errText(err))
    } finally {
      setBusy(null)
    }
  }

  const shown = contacts.filter((c) => matches(c, q.trim().toLowerCase()))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'group' ? 'New group' : 'New message'}
      description={mode === 'group' ? 'Pick a name and who’s in it.' : 'Chat with someone on your team.'}
      footer={
        mode === 'group' ? (
          <>
            <Button variant="secondary" onClick={() => setMode('direct')}>
              Back
            </Button>
            <Button type="submit" form="new-group" loading={busy === 'group'} disabled={!title.trim() || !picked.length}>
              Create group{picked.length ? ` (${picked.length + 1})` : ''}
            </Button>
          </>
        ) : undefined
      }
    >
      {mode === 'direct' ? (
        <div className="space-y-3">
          {canGroup && (
            <button type="button" onClick={() => setMode('group')} className="flex w-full items-center gap-3 rounded-xl border border-ink-200 px-3 py-2.5 text-left hover:bg-ink-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <UsersRound className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-ink-900">New group</span>
            </button>
          )}
          <SearchBox value={q} onChange={setQ} label="Search your team" />
          {isError ? (
            <p className="text-sm text-red-600">{errText(error)}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto" aria-label="Team members">
              {isLoading && <li className="py-4 text-sm text-ink-500">Loading your team…</li>}
              {!isLoading && contacts.length === 0 && (
                <li className="py-4 text-sm text-ink-500">
                  {me.role === 'organizer' ? 'Add people in Team, or assign staff to a gate, and you can chat with them here.' : 'Nobody on your team can chat yet.'}
                </li>
              )}
              {!isLoading && contacts.length > 0 && shown.length === 0 && <li className="py-4 text-sm text-ink-500">No one matches that search.</li>}
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => startDirect(c)}
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-ink-50 disabled:opacity-60"
                  >
                    <PersonAvatar user={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {roleLabel(c.role)} · {c.email}
                      </span>
                    </span>
                    {busy === c.id && <span className="text-xs text-ink-500">Opening…</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form id="new-group" onSubmit={createGroup} className="space-y-4">
          <Input label="Group name" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stage crew" autoFocus />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-800">Members</p>
            <PeoplePicker people={contacts} selected={picked} loading={isLoading} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
          </div>
        </form>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

export const InfoDrawer: React.FC<{ conversation: Conversation; me: AuthUser; open: boolean; onClose: () => void; onLeft: () => void }> = ({ conversation, me, open, onClose, onLeft }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: conversationKey(conversation.id), queryFn: () => chatApi.conversation(conversation.id), enabled: open })
  const conv = data ?? conversation
  const members = conv.members ?? []
  const isGroup = conv.kind === 'group'
  const admin = isGroup && conv.my_role === 'admin'
  const manageable = admin && !conv.is_event_crew
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conv.title)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const { data: contacts = [], isLoading: contactsLoading } = useContacts(adding)
  const memberIds = useMemo(() => new Set(members.map((m) => m.user.id)), [members])

  useEffect(() => {
    if (!open) {
      setRenaming(false)
      setAdding(false)
      setPicked([])
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const apply = (c: Conversation) => {
    qc.setQueryData(conversationKey(c.id), c)
    qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.map((x) => (x.id === c.id ? { ...x, ...c } : x)))
  }

  const act = async (key: string, fn: () => Promise<Conversation>, success?: string) => {
    setBusy(key)
    try {
      apply(await fn())
      if (success) toast.success(success)
      return true
    } catch (e) {
      toast.error('Couldn’t do that', errText(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const leave = async () => {
    if (!(await toast.confirm({ title: `Leave ${conv.title}?`, description: 'You won’t get its messages any more. An admin can add you back.', confirmLabel: 'Leave group', danger: true }))) return
    setBusy('leave')
    try {
      await chatApi.leave(conv.id)
      qc.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) => list?.filter((x) => x.id !== conv.id))
      toast.success(`You left ${conv.title}`)
      onLeft()
    } catch (e) {
      toast.error('Couldn’t leave the group', errText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={isGroup ? 'Group info' : 'Chat info'}>
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-pop animate-pop-in">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-ink-100 px-5">
          <h2 className="text-lg font-bold text-ink-900">{isGroup ? 'Group info' : 'Chat info'}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <div className="flex flex-col items-center text-center">
            <ConversationAvatar conversation={conv} size="lg" />
            {renaming ? (
              <form
                className="mt-3 flex w-full gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (title.trim() && (await act('rename', () => chatApi.rename(conv.id, title.trim()), 'Group renamed'))) setRenaming(false)
                }}
              >
                <input
                  aria-label="Group name"
                  autoFocus
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-[10px] border border-ink-200 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <Button type="submit" size="md" loading={busy === 'rename'}>
                  Save
                </Button>
              </form>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 text-lg font-bold text-ink-900">
                {conv.title}
                {manageable && (
                  <button
                    type="button"
                    onClick={() => {
                      setTitle(conv.title)
                      setRenaming(true)
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                    aria-label="Rename group"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </p>
            )}
            <p className="text-sm text-ink-500">
              {isGroup ? `${conv.member_count} members` : conv.other_member ? `${roleLabel(conv.other_member.role)} · ${conv.other_member.email}` : ''}
            </p>
            {conv.is_event_crew && (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-left text-sm text-emerald-900">
                Event crew group{conv.event ? ` for ${conv.event.title}` : ''}. Members are added and removed automatically from gate assignments.
              </p>
            )}
          </div>

          <div className="divide-y divide-ink-100 rounded-2xl border border-ink-200">
            <button
              type="button"
              disabled={busy === 'mute'}
              onClick={() => act('mute', () => chatApi.mute(conv.id, !conv.muted), conv.muted ? 'Notifications on' : 'Chat muted')}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-ink-50 disabled:opacity-60"
            >
              {conv.muted ? <Bell className="h-5 w-5 text-ink-500" aria-hidden /> : <BellOff className="h-5 w-5 text-ink-500" aria-hidden />}
              <span className="flex-1 font-medium text-ink-900">{conv.muted ? 'Unmute' : 'Mute'}</span>
              <span className="text-xs text-ink-500">{conv.muted ? 'Muted: no badge or push' : 'You get notifications'}</span>
            </button>
            {isGroup && !conv.is_event_crew && conv.owner_id !== me.id && (
              <button type="button" disabled={busy === 'leave'} onClick={leave} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                <LogOut className="h-5 w-5" aria-hidden />
                Leave group
              </button>
            )}
          </div>

          {isGroup && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-900">Members</h3>
                {manageable && !adding && (
                  <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
                    Add people
                  </Button>
                )}
              </div>
              {adding && (
                <div className="mb-4 space-y-3 rounded-2xl bg-ink-50 p-3">
                  <PeoplePicker
                    people={contacts.filter((c) => !memberIds.has(c.id))}
                    selected={picked}
                    loading={contactsLoading}
                    onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!picked.length}
                      loading={busy === 'add'}
                      onClick={async () => {
                        if (await act('add', () => chatApi.addMembers(conv.id, picked), `Added ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`)) {
                          setAdding(false)
                          setPicked([])
                        }
                      }}
                    >
                      Add {picked.length || ''}
                    </Button>
                  </div>
                </div>
              )}
              <ul className="divide-y divide-ink-100">
                {members.map((m) => {
                  const isOwner = m.user.id === conv.owner_id
                  const self = m.user.id === me.id
                  return (
                    <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                      <PersonAvatar user={m.user} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-ink-900">
                            {m.user.name}
                            {self && <span className="font-normal text-ink-500"> (you)</span>}
                          </span>
                          {m.role === 'admin' && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-marigold-50 px-1.5 py-0.5 text-[11px] font-semibold text-marigold-800">
                              <Crown className="h-3 w-3" aria-hidden />
                              Admin
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink-500">{roleLabel(m.user.role)}</span>
                      </span>
                      {manageable && !self && !isOwner && (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => act(`role-${m.user.id}`, () => chatApi.setRole(conv.id, m.user.id, m.role === 'admin' ? 'member' : 'admin'), m.role === 'admin' ? `${m.user.name} is a member now` : `${m.user.name} is an admin now`)}
                            className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 disabled:opacity-50"
                          >
                            {m.role === 'admin' ? 'Make member' : 'Make admin'}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={async () => {
                              if (await toast.confirm({ title: `Remove ${m.user.name}?`, description: `They won’t see new messages in ${conv.title}.`, confirmLabel: 'Remove', danger: true }))
                                await act(`rm-${m.user.id}`, () => chatApi.removeMember(conv.id, m.user.id), `${m.user.name} removed`)
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                            aria-label={`Remove ${m.user.name}`}
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
