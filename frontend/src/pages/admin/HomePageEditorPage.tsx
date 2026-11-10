import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card, ErrorState, ImageUpload, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { FEATURE_ICONS, HOME_DEFAULTS, HOME_KEY, mergeHome, type HomeContent, type StepsTab } from '@/lib/home-content'
import { request } from '@/services/api'
import { cn } from '@/lib/utils'
import { PAGE, Switch } from './shared'

type Key = keyof HomeContent

/** Superadmin → Home page: every text, list and section switch of the home page. Saves the whole page at once. */
export const HomePageEditorPage: React.FC = () => {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: HOME_KEY, queryFn: () => request<{ data: Record<string, unknown> }>('/platform/home-content/') })
  const [c, setC] = useState<HomeContent | null>(null)
  const [saved, setSaved] = useState('')
  useEffect(() => {
    if (data && !c) {
      const merged = mergeHome(HOME_DEFAULTS, data.data)
      setC(merged)
      setSaved(JSON.stringify(merged))
    }
  }, [data, c])
  const save = useMutation({
    mutationFn: () => request<{ data: Record<string, unknown> }>('/platform/home-content/', { method: 'PUT', body: JSON.stringify({ data: c }) }),
    onSuccess: (r) => {
      qc.setQueryData(HOME_KEY, r)
      setSaved(JSON.stringify(c))
      toast.success('Home page saved', 'Visitors see the changes straight away.')
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })

  if (isError) return <div className={PAGE}><ErrorState message={(error as Error).message} onRetry={() => void refetch()} /></div>
  if (isLoading || !c) return <div className={PAGE}><Skeleton className="h-96 rounded-2xl" /></div>

  const dirty = JSON.stringify(c) !== saved
  const set = <K extends Key>(k: K, v: Partial<HomeContent[K]>) => setC((x) => (x ? { ...x, [k]: { ...x[k], ...v } } : x))
  const reset = (k: Key) => setC((x) => (x ? { ...x, [k]: structuredClone(HOME_DEFAULTS[k]) } : x))
  const bind = <K extends Key>(k: K, f: keyof HomeContent[K] & string) => ({
    value: String(c[k][f] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, { [f]: e.target.value } as Partial<HomeContent[K]>),
  })
  const head = (k: Key) =>
    'eyebrow' in c[k] ? (
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Small heading" {...bind(k, 'eyebrow' as never)} />
        <Input label="Title" {...bind(k, 'title' as never)} />
      </div>
    ) : null

  return (
    <div className={PAGE}>
      <PageHeader
        title="Home page"
        description="Edit what eventlaya.com shows. Sections with live data (events, vendors, past events) fill themselves; turn any section off with its switch."
        actions={
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-50">
            <ExternalLink className="h-4 w-4" aria-hidden /> View home page
          </a>
        }
      />

      <Block title="Top: search" onReset={() => reset('hero')}>
        <Input label="Badge" {...bind('hero', 'badge')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Headline start" {...bind('hero', 'title_before')} />
          <Input label="Highlighted word" {...bind('hero', 'title_highlight')} />
          <Input label="Headline end" {...bind('hero', 'title_after')} />
        </div>
        <Textarea label="Text under the headline" rows={2} {...bind('hero', 'subtitle')} />
        <Switch checked={c.hero.show_categories} onChange={(v) => set('hero', { show_categories: v })} label="Show the category tiles" />
        <Switch checked={c.hero.show_vendor_links} onChange={(v) => set('hero', { show_vendor_links: v })} label="Show the popular vendor links" />
      </Block>

      <Block title="All in one flow" show={c.flow.show} onShow={(v) => set('flow', { show: v })} onReset={() => reset('flow')}>
        {head('flow')}
        <Textarea label="Text" rows={2} {...bind('flow', 'body')} />
        <Input label="Button" {...bind('flow', 'cta_label')} />
        <div className="grid gap-4 sm:grid-cols-2">
          {c.flow.points.map((p, i) => (
            <Input key={i} label={`Point ${i + 1}`} value={p} onChange={(e) => set('flow', { points: c.flow.points.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
        </div>
      </Block>

      <Block title="Featured & upcoming events (live)" show={c.events.show} onShow={(v) => set('events', { show: v })} onReset={() => reset('events')}>
        {head('events')}
        <p className="text-sm text-ink-500">Shows your upcoming events, featured ones first. Choose which events are featured in Featured events.</p>
      </Block>

      <Block title="Featured vendors (live)" show={c.vendors.show} onShow={(v) => set('vendors', { show: v })} onReset={() => reset('vendors')}>
        {head('vendors')}
      </Block>

      <Block title="Features" show={c.features.show} onShow={(v) => set('features', { show: v })} onReset={() => reset('features')}>
        {head('features')}
        <ListEditor
          items={c.features.items}
          onChange={(items) => set('features', { items })}
          blank={{ icon: 'sparkles', title: '', body: '', accent: false }}
          addLabel="Add feature"
          render={(f, up) => (
            <>
              <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <Select label="Icon" value={f.icon} onChange={(e) => up({ icon: e.target.value })}>
                  {FEATURE_ICONS.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
                <Input label="Title" value={f.title} onChange={(e) => up({ title: e.target.value })} />
              </div>
              <Input label="Text" value={f.body} onChange={(e) => up({ body: e.target.value })} />
              <Switch checked={f.accent} onChange={(v) => up({ accent: v })} label="Highlight (pink tile)" size="sm" />
            </>
          )}
        />
      </Block>

      <Block title="Dashboard tour" show={c.dashboard.show} onShow={(v) => set('dashboard', { show: v })} onReset={() => reset('dashboard')}>
        {head('dashboard')}
        <Input label="Text" {...bind('dashboard', 'subtitle')} />
      </Block>

      <Block title="Testimonials" show={c.testimonials.show} onShow={(v) => set('testimonials', { show: v })} onReset={() => reset('testimonials')}>
        {head('testimonials')}
        <p className="text-sm text-ink-500">Only real quotes from real organizers, with their permission. The section stays hidden until you add one.</p>
        <ListEditor
          items={c.testimonials.items}
          onChange={(items) => set('testimonials', { items })}
          blank={{ quote: '', name: '', org: '', photo: '', rating: 5 }}
          addLabel="Add testimonial"
          render={(t, up) => (
            <>
              <Textarea label="Quote" rows={2} value={t.quote} onChange={(e) => up({ quote: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Name" value={t.name} onChange={(e) => up({ name: e.target.value })} />
                <Input label="Organization" value={t.org} onChange={(e) => up({ org: e.target.value })} />
                <Select label="Stars" value={String(t.rating)} onChange={(e) => up({ rating: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'None' : n}
                    </option>
                  ))}
                </Select>
              </div>
              <ImageUpload label="Photo (optional)" kind="avatar" shape="square" value={t.photo || null} onChange={(v) => up({ photo: v ?? '' })} />
            </>
          )}
        />
      </Block>

      <Block title="Partners" show={c.partners.show} onShow={(v) => set('partners', { show: v })} onReset={() => reset('partners')}>
        {head('partners')}
        <p className="text-sm text-ink-500">Organizations that really use Eventlaya. Hidden until you add one.</p>
        <ListEditor
          items={c.partners.items}
          onChange={(items) => set('partners', { items })}
          blank={{ name: '', logo: '', url: '' }}
          addLabel="Add partner"
          render={(p, up) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Name" value={p.name} onChange={(e) => up({ name: e.target.value })} />
                <Input label="Website (optional)" value={p.url} placeholder="https://" onChange={(e) => up({ url: e.target.value })} />
              </div>
              <ImageUpload label="Logo (optional)" kind="logo" shape="square" value={p.logo || null} onChange={(v) => up({ logo: v ?? '' })} />
            </>
          )}
        />
      </Block>

      <Block title="Past events (live)" show={c.portfolio.show} onShow={(v) => set('portfolio', { show: v })} onReset={() => reset('portfolio')}>
        {head('portfolio')}
        <p className="text-sm text-ink-500">Shows once at least three past events have a banner.</p>
      </Block>

      <Block title="Four steps" show={c.steps.show} onShow={(v) => set('steps', { show: v })} onReset={() => reset('steps')}>
        {head('steps')}
        {(['attendee', 'organizer', 'vendor'] as const).map((who) => {
          const tab: StepsTab = c.steps[who]
          const up = (v: Partial<StepsTab>) => set('steps', { [who]: { ...tab, ...v } })
          return (
            <fieldset key={who} className="space-y-3 rounded-xl border border-ink-200 p-4">
              <legend className="px-1 text-sm font-semibold text-ink-800">{tab.label || who}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Tab name" value={tab.label} onChange={(e) => up({ label: e.target.value })} />
                <Input label="Button" value={tab.cta_label} onChange={(e) => up({ cta_label: e.target.value })} />
                <Input label="Button link" value={tab.cta_to} placeholder="/signup" onChange={(e) => up({ cta_to: e.target.value })} />
              </div>
              {tab.steps.map((st, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Input label={`Step ${i + 1}`} value={st.title} onChange={(e) => up({ steps: tab.steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <Input label="Text" value={st.body} onChange={(e) => up({ steps: tab.steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
                </div>
              ))}
            </fieldset>
          )
        })}
      </Block>

      <Block title="Questions (FAQ)" show={c.faq.show} onShow={(v) => set('faq', { show: v })} onReset={() => reset('faq')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" {...bind('faq', 'title')} />
          <Input label="Text under the title" {...bind('faq', 'subtitle')} />
        </div>
        <ListEditor
          items={c.faq.items}
          onChange={(items) => set('faq', { items })}
          blank={{ q: '', a: '' }}
          addLabel="Add question"
          render={(f, up) => (
            <>
              <Input label="Question" value={f.q} onChange={(e) => up({ q: e.target.value })} />
              <Textarea label="Answer" rows={2} value={f.a} onChange={(e) => up({ a: e.target.value })} />
            </>
          )}
        />
      </Block>

      <Block title="Contact" show={c.contact.show} onShow={(v) => set('contact', { show: v })} onReset={() => reset('contact')}>
        {head('contact')}
        <Textarea label="Text" rows={2} {...bind('contact', 'body')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" {...bind('contact', 'email')} />
          <Input label="Phone (optional)" {...bind('contact', 'phone')} />
          <Input label="Location" {...bind('contact', 'location')} />
          <Input label="Support hours (optional)" placeholder="Sun – Fri, 9 AM – 6 PM" {...bind('contact', 'hours')} />
        </div>
        <p className="text-sm text-ink-500">Messages from the form arrive in Contact messages.</p>
      </Block>

      <Block title="Footer & social links" onReset={() => (reset('footer'), reset('socials'))}>
        <Textarea label="About text" rows={2} {...bind('footer', 'about')} />
        <div className="grid gap-4 sm:grid-cols-2">
          {(['facebook', 'instagram', 'youtube', 'tiktok'] as const).map((k) => (
            <Input key={k} label={k[0].toUpperCase() + k.slice(1)} placeholder="https://" {...bind('socials', k)} />
          ))}
        </div>
      </Block>

      {/* Save bar */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-end gap-3 rounded-2xl border border-ink-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <span className="mr-auto text-sm text-ink-500">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <Button variant="secondary" disabled={!dirty} onClick={() => setC(JSON.parse(saved))}>
          Discard
        </Button>
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          Save home page
        </Button>
      </div>
    </div>
  )
}

export default HomePageEditorPage

const Block: React.FC<{ title: string; show?: boolean; onShow?: (v: boolean) => void; onReset: () => void; children: React.ReactNode }> = ({ title, show, onShow, onReset, children }) => {
  const [open, setOpen] = useState(false)
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-3 px-5 py-4">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-400 transition-transform', !open && '-rotate-90')} aria-hidden />
          <span className="truncate font-semibold text-ink-900">{title}</span>
          {show === false && <span className="text-xs font-medium text-ink-500">Hidden</span>}
        </button>
        {onShow && <Switch checked={!!show} onChange={onShow} label={`Show ${title}`} size="sm" />}
      </div>
      {open && (
        <div className="space-y-4 border-t border-ink-100 px-5 py-5">
          {children}
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Back to the original texts
          </button>
        </div>
      )}
    </Card>
  )
}

/** A list of items with move up/down, remove and add. */
function ListEditor<T>({ items, onChange, blank, addLabel, render }: { items: T[]; onChange: (items: T[]) => void; blank: T; addLabel: string; render: (item: T, update: (v: Partial<T>) => void) => React.ReactNode }) {
  const move = (i: number, d: number) => {
    const next = [...items]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-ink-200 p-4">
          {render(item, (v) => onChange(items.map((x, j) => (j === i ? { ...x, ...v } : x))))}
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="h-4 w-4" aria-hidden />}>
              Up
            </Button>
            <Button size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="h-4 w-4" aria-hidden />}>
              Down
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto text-red-700" onClick={() => onChange(items.filter((_, j) => j !== i))} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...items, structuredClone(blank)])} icon={<Plus className="h-4 w-4" aria-hidden />}>
        {addLabel}
      </Button>
    </div>
  )
}
