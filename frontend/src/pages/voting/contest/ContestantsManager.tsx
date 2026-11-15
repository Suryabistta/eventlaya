import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Images, ArrowLeft, ArrowDown, ArrowUp, FileUp, GripVertical, ListOrdered, Pencil, Plus, Trash2, UserCheck, Users } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, IconButton, ImageGalleryUpload, ImageUpload, Input, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { uploadImage } from '@/components/ui/ImageUpload'
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
  const navigate = useNavigate()
  const editPath = (cid: string) => `/app/voting/contests/${contest.id}/contestants/${cid}`
  const [bulk, setBulk] = useState<'names' | 'csv' | null>(null)
  const [photos, setPhotos] = useState(false)
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
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(editPath('new'))}>Add contestant</Button>
        <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => setBulk('names')}>Add many</Button>
        <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => setBulk('csv')}>Import CSV</Button>
        {list.length > 0 && <Button variant="secondary" icon={<Images className="h-4 w-4" />} onClick={() => setPhotos(true)}>Upload photos</Button>}
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
                <IconButton label={`Edit ${c.name}`} onClick={() => navigate(editPath(c.id))}>
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

      {bulk && <BulkAdd contest={contest} mode={bulk} onClose={() => setBulk(null)} onSaved={refresh} />}
      {photos && <BulkPhotos contest={contest} contestants={list} onClose={() => setPhotos(false)} onSaved={refresh} />}
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
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-28 pt-6 sm:px-6 lg:pt-8">
      <div className="space-y-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {contest.title} · Contestants
        </button>
        <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">{contestant ? `Edit ${contestant.name}` : 'Add contestant'}</h1>
      </div>
      <form id="contestant-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!form.name?.trim()) { setErrors({ name: 'Give the contestant a name.' }); return } save.mutate() }} className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        {/* Photos: what voters see first */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          {contestant?.edit_url && <EditLinkCard url={contestant.edit_url} invitedAt={contestant.invited_at ?? null} />}
          <Card className="space-y-4 p-4">
            <ImageUpload label="Main photo" kind="contestant" shape="portrait" value={form.photo_url || null} onChange={(url) => set('photo_url', url ?? '')} hint="A clear portrait. Shown on the voting card." />
          </Card>
        </aside>

        <div className="min-w-0 space-y-5">
          <FormCard title="Basics">
            <Input label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoFocus />
            <Input label="Tagline" placeholder="Purwanchal Campus · Dharan" hint="One short line under the name: college, city or team." value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Number"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Automatic"
                value={form.number ?? ''}
                onChange={(e) => set('number', e.target.value === '' ? null : Number(e.target.value))}
                error={errors.number}
                hint={form.number != null ? `Shown as ${contest.number_prefix}${String(form.number).padStart(pad, '0')}` : 'Leave empty for the next free number'}
              />
              <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value as ContestantStatus)}>
                <option value="active">Active</option>
                <option value="eliminated">Eliminated</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="winner">Winner</option>
              </Select>
            </div>
          </FormCard>

          <FormCard title="About">
            <Textarea label="Bio" rows={5} placeholder="A few lines voters will read on the profile page" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </FormCard>

          <FormCard title="More photos" description="Shown as a gallery on the profile page.">
            <ImageGalleryUpload label="Gallery" kind="contestant" max={12} value={form.gallery ?? []} onChange={(v) => set('gallery', v)} />
          </FormCard>

          {contest.profile_fields.length > 0 && (
            <FormCard title="Profile" description="Private fields are only shown to you.">
              {errors.profile && <p className="text-xs font-medium text-red-600">{errors.profile}</p>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            </FormCard>
          )}

          <FormCard title="Social links" description="Optional. Shown as buttons on the profile page.">
            {errors.social_links && <p className="text-xs font-medium text-red-600">{errors.social_links}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOCIALS.map((s) => (
                <Input key={s.key} label={s.label} placeholder={s.placeholder} value={form.social_links?.[s.key] ?? ''} onChange={(e) => set('social_links', { ...(form.social_links ?? {}), [s.key]: e.target.value })} />
              ))}
            </div>
          </FormCard>

          <FormCard title="Profile link">
            <Input label="Link name" placeholder="Made from the name" value={form.slug} onChange={(e) => set('slug', e.target.value)} error={errors.slug} hint="The end of the profile address. Leave empty to use the name." />
          </FormCard>
        </div>
      </form>
      {/* Save bar stays in reach on long forms */}
      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="contestant-form" loading={save.isPending}>{contestant ? 'Save' : 'Add contestant'}</Button>
      </div>
    </div>
  )
}

/** /app/voting/contests/:id/contestants/:cid ('new' to add): the contestant form as its own page. */
export const ContestantEditPage: React.FC = () => {
  const { id, cid } = useParams<{ id: string; cid: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const back = () => navigate(`/app/voting/contests/${id}/edit?step=contestants`)
  const contest = useQuery({ queryKey: ['contest', id], queryFn: () => contestApi.get(id!) })
  const list = useQuery({ queryKey: contestantsKey(id!), queryFn: () => contestApi.contestants(id!), enabled: cid !== 'new' })
  if (contest.isError || list.isError) return <div className="p-6"><ErrorState message={(contest.error ?? list.error)?.message} onRetry={() => { void contest.refetch(); void list.refetch() }} /></div>
  if (!contest.data || (cid !== 'new' && !list.data)) return <div className="mx-auto max-w-3xl space-y-4 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 rounded-2xl" /></div>
  const existing = cid === 'new' ? null : list.data?.find((c) => c.id === cid) ?? null
  if (cid !== 'new' && !existing) return <div className="p-6"><ErrorState message="This contestant was removed." onRetry={back} /></div>
  return (
    <ContestantEditor
      key={cid}
      contest={contest.data}
      contestant={existing}
      onClose={back}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: contestantsKey(id!) })
        qc.invalidateQueries({ queryKey: ['contest', id] })
      }}
    />
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

const FormCard: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <Card className="space-y-4 p-5">
    <div>
      <h2 className="text-base font-bold text-ink-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
    </div>
    {children}
  </Card>
)

/** The contestant's private profile-edit link, for the organizer to pass on by hand (it's also in their message). */
const EditLinkCard: React.FC<{ url: string; invitedAt: string | null }> = ({ url, invitedAt }) => {
  const toast = useToast()
  return (
    <Card className="space-y-2 p-4">
      <p className="text-sm font-semibold text-ink-900">Their private edit link</p>
      <p className="text-xs text-ink-500">
        {invitedAt ? 'Sent with their voting link when voting opened.' : 'Sent automatically when voting opens.'} They can change their photos, tagline, bio and social links.
      </p>
      <Button size="sm" variant="secondary" className="w-full" onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          toast.success('Link copied', 'Send it only to this contestant.')
        } catch {
          toast.error('Couldn’t copy the link', url)
        }
      }}>Copy edit link</Button>
    </Card>
  )
}

/* ---------- Bulk photos: many files at once, matched to contestants by file name ---------- */

const slugish = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** "asha-rai.jpg", "Asha Rai.png", "07.jpg", "#7 asha.jpg" → the contestant, or undefined. */
function matchContestant(fileName: string, list: Contestant[]): Contestant | undefined {
  const base = slugish(fileName.replace(/\.[a-z0-9]+$/i, ''))
  if (!base) return undefined
  const exact = list.find((c) => slugish(c.name) === base || (c.slug && c.slug === base))
  if (exact) return exact
  const num = base.match(/^0*(\d+)(?:-|$)/)?.[1]
  if (num) {
    const byNumber = list.find((c) => c.number === Number(num))
    if (byNumber) return byNumber
  }
  // "asha-rai-portrait", "01-asha-rai": the name somewhere in the file name
  return list.find((c) => slugish(c.name).length > 2 && base.includes(slugish(c.name)))
}

const BulkPhotos: React.FC<{ contest: Contest; contestants: Contestant[]; onClose: () => void; onSaved: () => void }> = ({ contest, contestants, onClose, onSaved }) => {
  const toast = useToast()
  const [rows, setRows] = useState<{ file: File; preview: string; to: string; status: 'ready' | 'uploading' | 'done' | 'failed'; error?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const pick = (files: FileList | null) => {
    if (!files) return
    setRows((r) => [...r, ...Array.from(files).filter((f) => f.type.startsWith('image/')).map((file) => ({ file, preview: URL.createObjectURL(file), to: matchContestant(file.name, contestants)?.id ?? '', status: 'ready' as const }))])
  }
  const matched = rows.filter((r) => r.to && r.status !== 'done')
  const run = async () => {
    setBusy(true)
    let ok = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.to || r.status === 'done') continue
      setRows((all) => all.map((x, j) => (j === i ? { ...x, status: 'uploading' } : x)))
      try {
        const url = await uploadImage(r.file, 'contestant')
        await contestApi.updateContestant(contest.id, r.to, { photo_url: url })
        ok += 1
        setRows((all) => all.map((x, j) => (j === i ? { ...x, status: 'done' } : x)))
      } catch (e) {
        setRows((all) => all.map((x, j) => (j === i ? { ...x, status: 'failed', error: e instanceof Error ? e.message : 'Failed' } : x)))
      }
    }
    setBusy(false)
    onSaved()
    if (ok) toast.success(`${ok} ${ok === 1 ? 'photo' : 'photos'} added`, 'Each one is now that contestant’s main photo.')
  }
  const name = (c: Contestant) => `${c.display_number ? `${c.display_number} ` : ''}${c.name}`
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="Upload contestant photos"
      description="Pick many photos at once. Name the files after the contestant (asha-rai.jpg) or their number (07.jpg) and we match them for you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{rows.some((r) => r.status === 'done') ? 'Done' : 'Cancel'}</Button>
          <Button onClick={run} loading={busy} disabled={!matched.length}>Upload {matched.length || ''} {matched.length === 1 ? 'photo' : 'photos'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 p-6 text-center hover:border-brand-300 hover:bg-brand-50/40">
          <Images className="h-7 w-7 text-brand-600" aria-hidden />
          <span className="text-sm"><span className="font-semibold text-brand-700">Choose photos</span> (JPG, PNG, WebP; up to 5 MB each)</span>
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = '' }} disabled={busy} />
        </label>
        {rows.length > 0 && (
          <ul className="max-h-[50vh] divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-200">
            {rows.map((r, i) => (
              <li key={`${r.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <img src={r.preview} alt="" className="h-12 w-10 shrink-0 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-700" title={r.file.name}>{r.file.name}</span>
                {r.status === 'done' ? (
                  <span className="text-sm font-semibold text-emerald-700">Added</span>
                ) : r.status === 'uploading' ? (
                  <span className="text-sm text-ink-500">Uploading…</span>
                ) : (
                  <select
                    aria-label={`Contestant for ${r.file.name}`}
                    value={r.to}
                    disabled={busy}
                    onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, to: e.target.value, status: 'ready', error: undefined } : x)))}
                    className={cn('h-9 w-52 rounded-lg border px-2 text-sm', r.to ? 'border-ink-200' : 'border-marigold-400 bg-marigold-50')}
                  >
                    <option value="">Skip (no match)</option>
                    {contestants.map((c) => <option key={c.id} value={c.id}>{name(c)}{c.photo_url ? ' (has a photo)' : ''}</option>)}
                  </select>
                )}
                {r.status === 'failed' && <span className="text-xs text-red-600" title={r.error}>Failed</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
