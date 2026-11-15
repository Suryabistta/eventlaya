/** /contestant/:token: a contestant updates their own photo, extra photos, tagline, bio and social links.
 *  The private link comes in their "voting is open" message; no account needed. Name and number stay with the organizers. */
import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, Lock } from 'lucide-react'
import { request } from '@/services/api'
import { Button, Card, EmptyState, ImageGalleryUpload, ImageUpload, Input, Skeleton, Textarea, useToast } from '@/components/ui'
import type { SocialKey } from './api'

interface SelfData {
  contest: { title: string; event_title: string; status: string }
  contestant: {
    name: string
    display_number: string
    subtitle: string
    description: string
    photo_url: string
    gallery: string[]
    social_links: Partial<Record<SocialKey, string>>
  }
  profile_url: string
}

const SOCIALS: { key: SocialKey; label: string; placeholder: string }[] = [
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/…' },
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/…' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'tiktok.com/@…' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/…' },
]

export const ContestantSelfPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>()
  const toast = useToast()
  const base = `/voting/self/${encodeURIComponent(token)}/`
  const { data, isLoading, error } = useQuery({ queryKey: ['contestant-self', token], queryFn: () => request<SelfData>(base), retry: false })
  const [form, setForm] = useState<SelfData['contestant'] | null>(null)
  useEffect(() => {
    if (data && !form) setForm(data.contestant)
  }, [data, form])
  const set = <K extends keyof SelfData['contestant']>(k: K, v: SelfData['contestant'][K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const save = useMutation({
    mutationFn: () =>
      request<SelfData>(base, {
        method: 'PATCH',
        body: JSON.stringify({
          subtitle: form!.subtitle, description: form!.description, photo_url: form!.photo_url,
          gallery: form!.gallery, social_links: form!.social_links,
        }),
      }),
    onSuccess: (d) => {
      setForm(d.contestant)
      toast.success('Profile saved', 'Voters see the changes right away.')
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })

  const wrap = (children: React.ReactNode) => <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6">{children}</div>

  if (isLoading) return wrap(<div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-96 rounded-2xl" /></div>)
  if (error || !data || !form) {
    const off = (error as { code?: string } | null)?.code === 'edit_off'
    return wrap(
      <Card>
        <EmptyState
          icon={<Lock className="h-6 w-6" />}
          title={off ? 'Profile editing is off' : 'This link doesn’t work'}
          description={off ? 'The organizers update contestant profiles for this contest. Contact them to change your photo or bio.' : 'It may be old or mistyped. Ask the organizers for your link again.'}
        />
      </Card>,
    )
  }

  const uploadUrl = `/api${base}upload/`
  return wrap(
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-500">{data.contest.title}{data.contest.event_title !== data.contest.title ? ` · ${data.contest.event_title}` : ''}</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink-900">Your contestant profile</h1>
        <p className="mt-2 text-ink-600">
          Hi {form.name}{form.display_number ? ` (${form.display_number})` : ''}. Update how voters see you. This link is private, so don’t share it;
          share your <a href={data.profile_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">voting page <ExternalLink className="inline h-3.5 w-3.5" aria-hidden /></a> instead.
        </p>
      </div>

      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); save.mutate() }}
        className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start"
      >
        <Card className="mx-auto w-full max-w-[260px] p-4 lg:sticky lg:top-6 lg:max-w-none">
          <ImageUpload label="Main photo" kind="contestant" shape="portrait" uploadUrl={uploadUrl} value={form.photo_url || null} onChange={(url) => set('photo_url', url ?? '')} hint="A clear portrait. Shown on your voting card." />
        </Card>
        <div className="min-w-0 space-y-5">
          <Card className="space-y-4 p-5">
            <Input label="Tagline" placeholder="Purwanchal Campus · Dharan" hint="One short line under your name." value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} maxLength={255} />
            <Textarea label="About you" rows={6} placeholder="A few lines voters will read on your page" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Card>
          <Card className="p-5">
            <ImageGalleryUpload label="More photos" kind="contestant" max={12} uploadUrl={uploadUrl} value={form.gallery ?? []} onChange={(v) => set('gallery', v)} hint="Shown as a gallery on your page" />
          </Card>
          <Card className="space-y-4 p-5">
            <p className="font-semibold text-ink-900">Social links <span className="font-normal text-ink-500">(optional)</span></p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOCIALS.map((s) => (
                <Input key={s.key} label={s.label} placeholder={s.placeholder} value={form.social_links?.[s.key] ?? ''}
                  onChange={(e) => set('social_links', { ...(form.social_links ?? {}), [s.key]: e.target.value })} />
              ))}
            </div>
          </Card>
        </div>
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border lg:col-span-2">
          <p className="mr-auto hidden text-sm text-ink-500 sm:block">Your name and number are set by the organizers.</p>
          <Button type="submit" loading={save.isPending} icon={<Check className="h-4 w-4" />}>Save profile</Button>
        </div>
      </form>
    </div>,
  )
}
