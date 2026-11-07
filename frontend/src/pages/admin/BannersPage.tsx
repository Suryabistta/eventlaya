import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GalleryHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Banner } from '@/services/api'
import { useModuleEnabled } from '@/lib/modules'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ImageUpload, Input, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { platformApi } from './api'
import { PAGE, Switch, fmtDate } from './shared'

type Draft = Omit<Banner, 'id'> & { id?: string }

// <input type="datetime-local"> works in local time without a zone
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

/** Whether the slide is showing right now (active and inside its dates). */
function liveState(b: Banner): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  const now = Date.now()
  if (!b.is_active) return { label: 'Hidden', tone: 'neutral' }
  if (b.starts_at && new Date(b.starts_at).getTime() > now) return { label: `Starts ${fmtDate(b.starts_at)}`, tone: 'warning' }
  if (b.ends_at && new Date(b.ends_at).getTime() <= now) return { label: 'Ended', tone: 'neutral' }
  return { label: 'Live', tone: 'success' }
}

/** Superadmin → Banners: the sliding banner at the top of the marketplace (module `banners`). */
export const BannersPage: React.FC = () => {
  const toast = useToast()
  const qc = useQueryClient()
  const moduleOn = useModuleEnabled('banners')
  const [editing, setEditing] = useState<Draft | null>(null)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-banners'], queryFn: platformApi.banners })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-banners'] })
    void qc.invalidateQueries({ queryKey: ['banners'] })
  }
  const save = useMutation({
    mutationFn: (b: Partial<Banner>) => platformApi.saveBanner(b),
    onSuccess: (_r, b) => {
      refresh()
      setEditing(null)
      if (b.image !== undefined) toast.success('Banner saved')
    },
    onError: (err: Error) => toast.error('Couldn’t save the banner', err.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => platformApi.deleteBanner(id),
    onSuccess: () => {
      refresh()
      toast.success('Banner deleted')
    },
    onError: (err: Error) => toast.error('Couldn’t delete the banner', err.message),
  })

  const nextOrder = (data ?? []).reduce((m, b) => Math.max(m, b.order + 1), 0)
  const add = () =>
    setEditing({ placement: 'marketplace', image: '', title: '', link: '', order: nextOrder, is_active: true, starts_at: null, ends_at: null })
  const addButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={add}>
      Add banner
    </Button>
  )

  return (
    <div className={PAGE}>
      <PageHeader title="Banners" description="Slides at the top of the marketplace. Use wide images, about 5:1 (for example 2000 × 400)." actions={addButton} />
      {!moduleOn && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-ink-700">
          The Marketplace banners module is off, so visitors don’t see these slides.
          <ButtonLink to="/admin/modules" variant="secondary" size="sm">
            Modules
          </ButtonLink>
        </Card>
      )}

      {isLoading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load the banners." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={<GalleryHorizontal className="h-6 w-6" />}
          title="No banners yet"
          description="Until you add one, the marketplace shows no slider."
          action={addButton}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {data.map((b) => {
              const state = liveState(b)
              return (
                <li key={b.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                  <img src={b.image} alt="" className="aspect-[5/1] w-full rounded-lg bg-ink-100 object-cover sm:w-56" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">
                      {b.title || 'Untitled'} <Badge tone={state.tone}>{state.label}</Badge>
                    </p>
                    <p className="truncate text-sm text-ink-500">
                      #{b.order}
                      {b.link && ` · ${b.link}`}
                      {b.ends_at && ` · until ${fmtDate(b.ends_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch size="sm" checked={b.is_active} label={`Show ${b.title || 'banner'}`} disabled={save.isPending} onChange={(is_active) => save.mutate({ id: b.id, is_active })} />
                    <IconButton label="Edit banner" onClick={() => setEditing(b)}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label="Delete banner"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm('Delete this banner?')) remove.mutate(b.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {editing && <BannerForm key={editing.id ?? 'new'} draft={editing} saving={save.isPending} onClose={() => setEditing(null)} onSave={(b) => save.mutate(b)} />}
    </div>
  )
}

const BannerForm: React.FC<{ draft: Draft; saving: boolean; onClose: () => void; onSave: (b: Draft) => void }> = ({ draft, saving, onClose, onSave }) => {
  const [form, setForm] = useState(draft)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={draft.id ? 'Edit banner' : 'Add banner'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="banner-form" loading={saving} disabled={!form.image}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="banner-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, title: form.title.trim(), link: form.link.trim() })
        }}
      >
        <ImageUpload label="Image" kind="banner" value={form.image} onChange={(url) => set('image', url ?? '')} hint="Wide image, about 5:1. JPG, PNG or WebP, up to 5 MB." />
        <Input label="Title" hint="Describes the image for screen readers" value={form.title} onChange={(e) => set('title', e.target.value)} />
        <Input label="Link" hint="Optional. A page on the site (/marketplace/vendors/…) or https://…" value={form.link} onChange={(e) => set('link', e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Order" type="number" min={0} value={form.order} onChange={(e) => set('order', Math.max(0, Number(e.target.value) || 0))} />
          <Input label="Show from" type="datetime-local" hint="Optional" value={toLocalInput(form.starts_at)} onChange={(e) => set('starts_at', fromLocalInput(e.target.value))} />
          <Input label="Show until" type="datetime-local" hint="Optional" value={toLocalInput(form.ends_at)} onChange={(e) => set('ends_at', fromLocalInput(e.target.value))} />
        </div>
      </form>
    </Modal>
  )
}

export default BannersPage
