import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FileUp, GripVertical, ListOrdered, Pencil, Plus, Trash2, UserCheck, Users } from 'lucide-react'
import { Button, EmptyState, ErrorState, IconButton, ImageGalleryUpload, ImageUpload, Input, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { contestApi, type Contest, type Contestant, type ContestantInput, type ContestantStatus, type SocialKey } from './api'
import { ContestantPhoto, ContestantStatusBadge, NumberTag } from './shared'

const SOCIALS: { key: SocialKey; label: string; placeholder: string }[] = [
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/…' },
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/…' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'tiktok.com/@…' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/…' },
  { key: 'x', label: 'X (Twitter)', placeholder: 'x.com/…' },
  { key: 'website', label: 'Website', placeholder: 'example.com' },
]

export const contestantsKey = (id: string) => ['contest-contestants', id]

/** Contestants of a contest: list, add/edit, bulk add, CSV import, reorder and renumber. Saves immediately. */
export const ContestantsManager: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: contestantsKey(contest.id), queryFn: () => contestApi.contestants(contest.id) })
  const [editing, setEditing] = useState<Contestant | 'new' | null>(null)
  const [bulk, setBulk] = useState<'names' | 'csv' | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const fromApps = useMutation({
    mutationFn: () => contestApi.fromApplications(contest.id),
    onSuccess: (added) => {
      void qc.invalidateQueries({ queryKey: contestantsKey(contest.id) })
      toast.success(`Added ${added.length} ${added.length === 1 ? 'contestant' : 'contestants'}`, 'Name, photo and bio come from their applications.')
    },
    onError: (e: Error) => toast.error('Couldn’t add applicants', e.message),
  })

  const list = useMemo(() => {
    if (!data) return []
    if (!order) return data
    const by = new Map(data.map((c) => [c.id, c]))
    return order.map((id) => by.get(id)).filter(Boolean) as Contestant[]
  }, [data, order])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: contestantsKey(contest.id) })
    qc.invalidateQueries({ queryKey: ['contest', contest.id] })
  }

  const saveOrder = useMutation({
    mutationFn: (renumber: boolean) => contestApi.reorder(contest.id, list.map((c) => c.id), renumber),
    onSuccess: (rows, renumber) => {
      qc.setQueryData(contestantsKey(contest.id), rows)
      setOrder(null)
      toast.success(renumber ? 'Order saved and numbers reassigned' : 'Order saved')
    },
    onError: (e: Error) => toast.error('Couldn’t save the order', e.message),
  })

  const remove = async (c: Contestant) => {
    const ok = await toast.confirm({
      title: `Delete ${c.name}?`,
      description: c.votes ? 'They have votes, so they can only be marked as withdrawn.' : 'This can’t be undone.',
      confirmLabel: c.votes ? 'Mark as withdrawn' : 'Delete contestant',
      danger: true,
    })
    if (!ok) return
    try {
      if (c.votes) await contestApi.updateContestant(contest.id, c.id, { status: 'withdrawn' })
      else await contestApi.removeContestant(contest.id, c.id)
      refresh()
    } catch (e) {
      toast.error('Couldn’t remove the contestant', (e as Error).message)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const ids = list.map((c) => c.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOrder(ids)
  }

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = list.map((c) => c.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    setOrder(ids)
    setDragId(null)
  }

  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add contestant</Button>
        <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => setBulk('names')}>Add many</Button>
        <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => setBulk('csv')}>Import CSV</Button>
        <Button variant="secondary" icon={<UserCheck className="h-4 w-4" />} loading={fromApps.isPending} onClick={() => fromApps.mutate()}>
          Add accepted applicants
        </Button>
        {list.length > 1 && !order && (
          <Button variant="ghost" icon={<ListOrdered className="h-4 w-4" />} onClick={async () => {
            const ok = await toast.confirm({ title: 'Renumber everyone?', description: 'Numbers become 1, 2, 3… in the order shown. Shared posters with old numbers will be out of date.', confirmLabel: 'Renumber' })
            if (ok) saveOrder.mutate(true)
          }}>Renumber in this order</Button>
        )}
      </div>

      {order && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
          <span className="mr-auto font-medium">The order changed.</span>
          <Button size="sm" variant="ghost" onClick={() => setOrder(null)}>Undo</Button>
          <Button size="sm" variant="secondary" loading={saveOrder.isPending} onClick={() => saveOrder.mutate(true)}>Save and renumber</Button>
          <Button size="sm" loading={saveOrder.isPending} onClick={() => saveOrder.mutate(false)}>Save order</Button>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No contestants yet" description="Add them one by one, paste a list of names, or import a spreadsheet (CSV). Numbers are given automatically." />
      ) : (
        <ol className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
          {list.map((c, i) => (
            <li
              key={c.id}
              draggable
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(c.id)}
              className={cn('flex items-center gap-3 px-3 py-2.5 sm:px-4', dragId === c.id && 'opacity-50')}
            >
              <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-ink-300 sm:block" aria-hidden />
              <ContestantPhoto name={c.name} photo={c.photo_url} className="h-12 w-10 shrink-0 text-sm" rounded="rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <NumberTag value={c.display_number} className="text-xs" />
                  <span className="truncate font-semibold text-ink-900">{c.name}</span>
                  {c.status !== 'active' && <ContestantStatusBadge status={c.status} />}
                </p>
                <p className="truncate text-xs text-ink-500">
                  {[c.subtitle, c.votes ? `${c.votes.toLocaleString()} votes` : '', c.gallery.length ? `${c.gallery.length + (c.photo_url ? 1 : 0)} photos` : '']
                    .filter(Boolean)
                    .join(' · ') || 'No details yet'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </IconButton>
                <IconButton label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </IconButton>
                <IconButton label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                  <Pencil className="h-4 w-4" aria-hidden />
                </IconButton>
                <IconButton label={`Remove ${c.name}`} onClick={() => remove(c)} className="hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing && <ContestantEditor contest={contest} contestant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {bulk && <BulkAdd contest={contest} mode={bulk} onClose={() => setBulk(null)} onSaved={refresh} />}
    </div>
  )
}

const ContestantEditor: React.FC<{ contest: Contest; contestant: Contestant | null; onClose: () => void; onSaved: () => void }> = ({ contest, contestant, onClose, onSaved }) => {
  const toast = useToast()
  const [form, setForm] = useState<ContestantInput>(() => ({
    name: contestant?.name ?? '',
    subtitle: contestant?.subtitle ?? '',
    description: contestant?.description ?? '',
    photo_url: contestant?.photo_url ?? '',
    gallery: contestant?.gallery ?? [],
    social_links: contestant?.social_links ?? {},
    profile: contestant?.profile ?? {},
    number: contestant?.number ?? null,
    slug: contestant?.slug ?? '',
    status: contestant?.status ?? 'active',
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof ContestantInput>(k: K, v: ContestantInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: (form.name ?? '').trim(), slug: form.slug || '' }
      return contestant ? contestApi.updateContestant(contest.id, contestant.id, body) : contestApi.addContestant(contest.id, body)
    },
    onSuccess: (c) => {
      toast.success(contestant ? 'Contestant saved' : `${c.display_number} ${c.name} added`)
      onSaved()
      onClose()
    },
    onError: (e: Error & { data?: unknown }) => {
      const d = (e as { data?: Record<string, string[] | string> }).data
      if (d && typeof d === 'object') {
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(d)) next[k] = Array.isArray(v) ? v.join(' ') : String(v)
        setErrors(next)
      }
      toast.error('Couldn’t save the contestant', e.message)
    },
  })

  const pad = contest.number_padding || 1
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={contestant ? `Edit ${contestant.name}` : 'Add contestant'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="contestant-form" loading={save.isPending}>{contestant ? 'Save' : 'Add contestant'}</Button>
        </>
      }
    >
      <form id="contestant-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!form.name?.trim()) { setErrors({ name: 'Give the contestant a name.' }); return } save.mutate() }} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <ImageUpload label="Main photo" kind="contestant" shape="square" value={form.photo_url || null} onChange={(url) => set('photo_url', url ?? '')} hint="Portrait works best" />
          <div className="space-y-3">
            <Input label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoFocus />
            <Input label="Tagline" placeholder="Purwanchal Campus · Dharan" value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Number"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Automatic"
                value={form.number ?? ''}
                onChange={(e) => set('number', e.target.value === '' ? null : Number(e.target.value))}
                error={errors.number}
                hint={form.number != null ? `Shown as ${contest.number_prefix}${String(form.number).padStart(pad, '0')}` : 'Next free number'}
              />
              <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value as ContestantStatus)}>
                <option value="active">Active</option>
                <option value="eliminated">Eliminated</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="winner">Winner</option>
              </Select>
            </div>
          </div>
        </div>
        <Textarea label="Bio" rows={4} placeholder="A few lines voters will read on the profile page" value={form.description} onChange={(e) => set('description', e.target.value)} />
        <ImageGalleryUpload label="More photos" kind="contestant" max={12} value={form.gallery ?? []} onChange={(v) => set('gallery', v)} hint="Shown as a gallery on the profile page" />
        {contest.profile_fields.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-ink-900">Profile</legend>
            {errors.profile && <p className="text-xs font-medium text-red-600">{errors.profile}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {contest.profile_fields.map((f) => {
                const v = form.profile?.[f.key!] ?? ''
                const onChange = (val: string) => set('profile', { ...(form.profile ?? {}), [f.key!]: val })
                const label = `${f.label}${f.is_public ? '' : ' (private)'}`
                return f.field_type === 'select' ? (
                  <Select key={f.key} label={label} required={f.required} value={v} onChange={(e) => onChange(e.target.value)}>
                    <option value="">—</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input key={f.key} label={label} required={f.required} type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => onChange(e.target.value)} />
                )
              })}
            </div>
          </fieldset>
        )}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink-900">Social links</legend>
          {errors.social_links && <p className="text-xs font-medium text-red-600">{errors.social_links}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SOCIALS.map((s) => (
              <Input key={s.key} label={s.label} placeholder={s.placeholder} value={form.social_links?.[s.key] ?? ''} onChange={(e) => set('social_links', { ...(form.social_links ?? {}), [s.key]: e.target.value })} />
            ))}
          </div>
        </fieldset>
        <Input label="Link name" placeholder="Made from the name" value={form.slug} onChange={(e) => set('slug', e.target.value)} error={errors.slug} hint="Profile links also work with the number, e.g. …/c/7" />
      </form>
    </Modal>
  )
}

/** Paste names (one per line) or a CSV with a header row. */
const BulkAdd: React.FC<{ contest: Contest; mode: 'names' | 'csv'; onClose: () => void; onSaved: () => void }> = ({ contest, mode, onClose, onSaved }) => {
  const toast = useToast()
  const [text, setText] = useState('')
  const [rowErrors, setRowErrors] = useState<string[]>([])
  useEffect(() => setRowErrors([]), [text])
  const names = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const headers = ['name', 'number', 'subtitle', 'bio', ...contest.profile_fields.map((f) => f.label)]

  const save = useMutation({
    mutationFn: () => (mode === 'names' ? contestApi.bulkAdd(contest.id, names.map((name) => ({ name }))) : contestApi.importCsv(contest.id, text)),
    onSuccess: (rows) => {
      toast.success(`${rows.length} contestants added`, 'Numbers were given in order.')
      onSaved()
      onClose()
    },
    onError: (e: Error) => {
      const data = (e as { data?: { rows?: Record<string, Record<string, string[]>> } }).data
      setRowErrors(Object.entries(data?.rows ?? {}).map(([row, errs]) => `Row ${row}: ${Object.values(errs).flat().join(' ')}`))
      toast.error('Nothing was added', e.message)
    },
  })

  const readFile = async (f?: File) => {
    if (f) setText(await f.text())
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={mode === 'names' ? 'Add many contestants' : 'Import contestants from CSV'}
      description={mode === 'names' ? 'One name per line. You can add photos and details afterwards.' : 'Export your spreadsheet as CSV. The first row must name the columns.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={mode === 'names' ? !names.length : !text.trim()}>
            {mode === 'names' ? `Add ${names.length || ''} contestants` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {mode === 'csv' && (
          <>
            <p className="text-sm text-ink-600">
              Columns we understand: <span className="font-mono text-xs">{headers.join(', ')}</span>. Leave “number” empty to number automatically.
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-brand-700">
              <FileUp className="h-4 w-4" aria-hidden /> Choose a CSV file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
          </>
        )}
        <Textarea
          label={mode === 'names' ? 'Names' : 'CSV'}
          rows={10}
          className="font-mono text-xs"
          placeholder={mode === 'names' ? 'Asha Rai\nBina Limbu\nChandra Gurung' : `${headers.join(',')}\nAsha Rai,1,Purwanchal Campus,Loves dance,21`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {rowErrors.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs text-red-800" role="alert">
            {rowErrors.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  )
}
