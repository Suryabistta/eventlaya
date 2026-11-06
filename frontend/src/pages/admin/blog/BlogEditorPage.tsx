import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bold,
  CheckCircle2,
  Circle,
  ExternalLink,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Plus,
  Quote,
  Table,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, ErrorState, Field, ImageUpload, Modal, Skeleton, controlClass, uploadImage, useToast } from '@/components/ui'
import { blogApi, type AdminPost, type BlogStatus, type FaqItem, type Rendered } from '@/pages/blog/api'
import { ARTICLE_PROSE } from '@/pages/blog/shared'
import { PAGE } from '../shared'
import { PostStatusBadge } from './BlogAdminPage'

const EMPTY: AdminPost = {
  id: '',
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  cover_image: '',
  cover_alt: '',
  category: 'guides',
  tags: [],
  cities: [],
  faq: [],
  status: 'draft',
  published_at: null,
  author_name: 'Eventlaya team',
  seo_title: '',
  canonical_url: '',
  noindex: false,
  focus_keyword: '',
  language: 'en',
  translation_of: '',
}

const FIELDS: (keyof AdminPost)[] = [
  'title', 'slug', 'excerpt', 'body', 'cover_image', 'cover_alt', 'category', 'tags', 'cities', 'faq', 'status',
  'published_at', 'author_name', 'seo_title', 'canonical_url', 'noindex', 'focus_keyword', 'language', 'translation_of',
]

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)

/** datetime-local value (browser time) ↔ ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Superadmin → Blog → New / Edit: Markdown editor with preview, image upload, FAQ and an SEO panel. */
export const BlogEditorPage: React.FC = () => {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const existing = useQuery({ queryKey: ['blog-admin', 'post', id], queryFn: () => blogApi.adminGet(id!), enabled: !isNew })
  const options = useQuery({ queryKey: ['blog-admin', 'options'], queryFn: blogApi.options, staleTime: 10 * 60_000 })

  if (!isNew && existing.isLoading) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[480px]" />
      </div>
    )
  }
  if (!isNew && existing.isError) {
    return (
      <div className={PAGE}>
        <ErrorState message="Couldn’t load this article." onRetry={() => existing.refetch()} />
      </div>
    )
  }
  return <Editor key={existing.data?.id ?? 'new'} initial={existing.data ?? EMPTY} options={options.data} />
}

type Tab = 'write' | 'preview'

const Editor: React.FC<{ initial: AdminPost; options?: Awaited<ReturnType<typeof blogApi.options>> }> = ({ initial, options }) => {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [post, setPost] = useState<AdminPost>(initial)
  const [saved, setSaved] = useState<AdminPost>(initial)
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id))
  const [tab, setTab] = useState<Tab>('write')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const dirty = useMemo(() => FIELDS.some((f) => JSON.stringify(post[f]) !== JSON.stringify(saved[f])), [post, saved])
  const set = <K extends keyof AdminPost>(key: K, value: AdminPost[K]) => setPost((p) => ({ ...p, [key]: value }))

  // Rendered body: preview tab + word count + SEO checks (debounced)
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [rendering, setRendering] = useState(false)
  useEffect(() => {
    setRendering(true)
    const t = setTimeout(() => {
      blogApi
        .preview(post.body)
        .then(setRendered)
        .catch(() => undefined)
        .finally(() => setRendering(false))
    }, 400)
    return () => clearTimeout(t)
  }, [post.body])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useMutation({
    mutationFn: (status?: BlogStatus) => {
      const body: Partial<AdminPost> = {}
      FIELDS.forEach((f) => ((body as Record<string, unknown>)[f] = post[f]))
      if (status) body.status = status
      if (!body.slug) delete body.slug
      return post.id ? blogApi.adminUpdate(post.id, body) : blogApi.adminCreate(body)
    },
    onSuccess: (data, status) => {
      setErrors({})
      setPost(data)
      setSaved(data)
      setSlugTouched(true)
      qc.invalidateQueries({ queryKey: ['blog-admin'] })
      qc.invalidateQueries({ queryKey: ['blog'] })
      qc.invalidateQueries({ queryKey: ['blog-status'] })
      toast.success(status === 'published' ? 'Published' : status === 'scheduled' ? 'Scheduled' : 'Saved', data.is_live ? `Live at /blog/${data.slug}` : undefined)
      if (!post.id) navigate(`/admin/blog/${data.id}`, { replace: true })
    },
    onError: (e: unknown) => {
      const data = (e as { data?: unknown }).data
      if (data && typeof data === 'object') {
        const out: Record<string, string> = {}
        Object.entries(data as Record<string, unknown>).forEach(([k, v]) => (out[k] = Array.isArray(v) ? String(v[0]) : String(v)))
        setErrors(out)
      }
      toast.error('Couldn’t save', e instanceof Error ? e.message : undefined)
    },
  })

  const remove = useMutation({
    mutationFn: () => blogApi.adminDelete(post.id),
    onSuccess: () => {
      setSaved(post)
      qc.invalidateQueries({ queryKey: ['blog-admin'] })
      qc.invalidateQueries({ queryKey: ['blog'] })
      toast.success('Article deleted')
      setTimeout(() => navigate('/admin/blog'), 0)
    },
    onError: (e: unknown) => toast.error('Couldn’t delete', e instanceof Error ? e.message : undefined),
  })

  // Ctrl/Cmd+S saves
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!saveRef.current.isPending) saveRef.current.mutate(undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isLive = Boolean(saved.is_live)
  const primaryLabel = post.status === 'scheduled' ? 'Schedule' : isLive ? 'Update' : 'Publish'
  const primaryStatus: BlogStatus = post.status === 'scheduled' ? 'scheduled' : 'published'

  return (
    <div className={PAGE}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/blog" className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Blog
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-900">{post.id ? 'Edit article' : 'New article'}</h1>
            {post.id && <PostStatusBadge post={saved} />}
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLive && (
            <a
              href={`/blog/${saved.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-100"
            >
              <ExternalLink className="h-4 w-4" aria-hidden /> View on site
            </a>
          )}
          {isLive ? (
            <Button variant="secondary" onClick={() => save.mutate('draft')} disabled={save.isPending}>
              Unpublish
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => save.mutate(post.status === 'draft' ? 'draft' : undefined)} loading={save.isPending && save.variables !== primaryStatus}>
              Save draft
            </Button>
          )}
          <Button onClick={() => save.mutate(primaryStatus)} loading={save.isPending && save.variables === primaryStatus}>
            {primaryLabel}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <Card className="space-y-4 p-5">
            <Field label="Title" required error={errors.title}>
              {(a) => (
                <input
                  {...a}
                  value={post.title}
                  onChange={(e) => {
                    const title = e.target.value
                    setPost((p) => ({ ...p, title, slug: slugTouched ? p.slug : slugify(title) }))
                  }}
                  placeholder="How to organize an event in Itahari"
                  className={cn(controlClass, 'text-lg font-semibold')}
                />
              )}
            </Field>
            <Field label="Address" hint="Letters, numbers and hyphens. Changing it after publishing breaks old links." error={errors.slug}>
              {(a) => (
                <div className="flex items-center rounded-[10px] border border-ink-200 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
                  <span className="pl-3 text-sm text-ink-500">eventlaya.com/blog/</span>
                  <input
                    {...a}
                    value={post.slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      set('slug', slugify(e.target.value))
                    }}
                    className="min-w-0 flex-1 rounded-r-[10px] bg-transparent px-1 py-2 text-sm text-ink-900 focus:outline-none"
                  />
                </div>
              )}
            </Field>
            <Field
              label="Short description"
              hint="Shown on cards and as the Google description. Answer the question in one or two sentences."
              error={errors.excerpt}
            >
              {(a) => (
                <div>
                  <textarea {...a} rows={3} value={post.excerpt} onChange={(e) => set('excerpt', e.target.value)} className={controlClass} />
                  <LengthMeter value={post.excerpt.length} min={120} max={160} />
                </div>
              )}
            </Field>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <div role="tablist" aria-label="Editor mode" className="inline-flex rounded-lg bg-ink-100 p-0.5">
                {(['write', 'preview'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    type="button"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn('rounded-md px-3 py-1.5 text-sm font-semibold capitalize', tab === t ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900')}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === 'write' && <Toolbar textarea={bodyRef} onChange={(v) => set('body', v)} />}
              <span className="text-xs text-ink-500">
                {rendering ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-label="Updating" /> : null} {rendered?.word_count ?? 0} words ·{' '}
                {rendered?.reading_minutes ?? 1} min read
              </span>
            </div>
            {tab === 'write' ? (
              <textarea
                ref={bodyRef}
                aria-label="Article body (Markdown)"
                value={post.body}
                onChange={(e) => set('body', e.target.value)}
                spellCheck
                placeholder={'Start with a 2–3 sentence answer to the question in the title.\n\n## A question people search for?\n\nA direct answer first, then the details…'}
                className="block min-h-[560px] w-full resize-y border-0 px-5 py-4 font-mono text-[13.5px] leading-relaxed text-ink-900 focus:outline-none focus:ring-0"
              />
            ) : (
              <div className="min-h-[560px] px-5 py-6 sm:px-8">
                <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-ink-900">{post.title || 'Untitled'}</h1>
                {post.excerpt && <p className="mt-3 text-[1.0625rem] text-ink-700">{post.excerpt}</p>}
                <div className={cn(ARTICLE_PROSE, 'mt-8 max-w-[70ch]')} dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }} />
                {post.faq.length > 0 && (
                  <div className="mt-10 max-w-[70ch] border-t border-ink-100 pt-6">
                    <h2 className="font-display text-xl font-bold text-ink-900">Frequently asked questions</h2>
                    {post.faq.map((f, i) => (
                      <div key={i} className="mt-4">
                        <p className="font-semibold text-ink-900">{f.q}</p>
                        <p className="mt-1 text-ink-700">{f.a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="border-t border-ink-100 px-5 py-2 text-xs text-ink-500">
              Markdown: <code>## Heading</code>, <code>**bold**</code>, <code>[link](/pricing)</code>, <code>- list</code>, tables with <code>|</code>. Use{' '}
              <code>##</code> for sections (the title is the only H1). Ctrl+S saves.
            </p>
          </Card>

          <FaqEditor items={post.faq} onChange={(faq) => set('faq', faq)} error={errors.faq} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold text-ink-900">Publishing</h2>
            <Field label="Status" error={errors.status}>
              {(a) => (
                <select {...a} value={post.status} onChange={(e) => set('status', e.target.value as BlogStatus)} className={controlClass}>
                  <option value="draft">Draft (only you can see it)</option>
                  <option value="published">Published</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              )}
            </Field>
            {(post.status === 'scheduled' || post.published_at) && (
              <Field
                label={post.status === 'scheduled' ? 'Publish on' : 'Published on'}
                hint="Your browser’s time zone."
                error={errors.published_at}
              >
                {(a) => (
                  <input
                    {...a}
                    type="datetime-local"
                    value={toLocalInput(post.published_at)}
                    onChange={(e) => set('published_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                    className={controlClass}
                  />
                )}
              </Field>
            )}
            <Field label="Author" error={errors.author_name}>
              {(a) => <input {...a} value={post.author_name} onChange={(e) => set('author_name', e.target.value)} className={controlClass} />}
            </Field>
            {post.id && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:underline">
                <Trash2 className="h-4 w-4" aria-hidden /> Delete article
              </button>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold text-ink-900">Topic</h2>
            <Field label="Category" error={errors.category}>
              {(a) => (
                <select {...a} value={post.category} onChange={(e) => set('category', e.target.value)} className={controlClass}>
                  {(options?.categories ?? [{ slug: post.category, label: post.category }]).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Language" error={errors.language}>
              {(a) => (
                <select {...a} value={post.language ?? 'en'} onChange={(e) => set('language', e.target.value)} className={controlClass}>
                  {(options?.languages ?? [{ value: 'en', label: 'English' }, { value: 'ne', label: 'नेपाली (Nepali)' }]).map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Translation of"
              hint="Optional. The address (slug) of the same article in another language, e.g. how-to-organize-an-event-in-itahari. Links the two with a “Read in …” switch and hreflang."
              error={errors.translation_of}
            >
              {(a) => (
                <input {...a} value={post.translation_of ?? ''} onChange={(e) => set('translation_of', e.target.value.trim())} placeholder="english-article-slug" className={controlClass} />
              )}
            </Field>
            <TagInput label="Tags" hint="Press Enter after each tag." values={post.tags} onChange={(v) => set('tags', v)} />
            <div>
              <p className="text-sm font-medium text-ink-800">Target cities</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(options?.cities ?? []).map((c) => {
                  const on = post.cities.includes(c)
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('cities', on ? post.cities.filter((x) => x !== c) : [...post.cities, c])}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600 hover:border-ink-300',
                      )}
                    >
                      {c}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-ink-500">None selected = all of Nepal.</p>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold text-ink-900">Cover image</h2>
            <ImageUpload label="Cover (1200 × 630 works best)" kind="blog" value={post.cover_image} onChange={(url) => set('cover_image', url ?? '')} />
            {post.cover_image && (
              <Field label="Image description (alt text)" hint="What the picture shows, for screen readers and search.">
                {(a) => <input {...a} value={post.cover_alt} onChange={(e) => set('cover_alt', e.target.value)} className={controlClass} />}
              </Field>
            )}
          </Card>

          <SeoPanel post={post} set={set} rendered={rendered} errors={errors} />
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this article?"
        description="It disappears from the blog, the sitemap and search results over time. This can’t be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">{post.title}</p>
      </Modal>

    </div>
  )
}

/* ------------------------------------------------------------------ */

const LengthMeter: React.FC<{ value: number; min: number; max: number }> = ({ value, min, max }) => {
  const tone = value === 0 ? 'text-ink-400' : value < min ? 'text-marigold-700' : value > max ? 'text-red-600' : 'text-emerald-700'
  const note = value === 0 ? '' : value < min ? ' · a little short' : value > max ? ' · Google will cut it off' : ' · good length'
  return (
    <p className={cn('mt-1 text-xs', tone)}>
      {value} characters (aim for {min}–{max}){note}
    </p>
  )
}

function wrapSelection(el: HTMLTextAreaElement, before: string, after = '', placeholder = '') {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e) || placeholder
  const next = value.slice(0, s) + before + selected + after + value.slice(e)
  return { next, cursor: [s + before.length, s + before.length + selected.length] as const }
}

function prefixLines(el: HTMLTextAreaElement, prefix: (i: number) => string) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  const block = value.slice(lineStart, e) || ''
  const lines = block.split('\n').map((l, i) => prefix(i) + l.replace(/^(#{1,6} |[-*] |\d+\. |> )/, ''))
  const replaced = lines.join('\n')
  return { next: value.slice(0, lineStart) + replaced + value.slice(e), cursor: [lineStart, lineStart + replaced.length] as const }
}

const Toolbar: React.FC<{ textarea: React.RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void }> = ({ textarea, onChange }) => {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const apply = useCallback(
    (fn: (el: HTMLTextAreaElement) => { next: string; cursor: readonly [number, number] }) => {
      const el = textarea.current
      if (!el) return
      const { next, cursor } = fn(el)
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(cursor[0], cursor[1])
      })
    },
    [onChange, textarea],
  )
  const tools: { label: string; icon: React.ElementType; run: () => void }[] = [
    { label: 'Bold', icon: Bold, run: () => apply((el) => wrapSelection(el, '**', '**', 'bold text')) },
    { label: 'Italic', icon: Italic, run: () => apply((el) => wrapSelection(el, '_', '_', 'italic text')) },
    { label: 'Section heading (H2)', icon: Heading2, run: () => apply((el) => prefixLines(el, () => '## ')) },
    { label: 'Sub-heading (H3)', icon: Heading3, run: () => apply((el) => prefixLines(el, () => '### ')) },
    { label: 'Link', icon: Link2, run: () => apply((el) => wrapSelection(el, '[', '](/blog/)', 'link text')) },
    { label: 'Bulleted list', icon: List, run: () => apply((el) => prefixLines(el, () => '- ')) },
    { label: 'Numbered list', icon: ListOrdered, run: () => apply((el) => prefixLines(el, (i) => `${i + 1}. `)) },
    { label: 'Quote', icon: Quote, run: () => apply((el) => prefixLines(el, () => '> ')) },
    {
      label: 'Table',
      icon: Table,
      run: () => apply((el) => wrapSelection(el, '\n| Column | Column |\n| --- | --- |\n| ', ' | |\n', 'Cell')),
    },
  ]
  const onFile = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImage(file, 'blog')
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
      apply((el) => wrapSelection(el, `\n![${alt}](${url})\n`, '', ''))
    } catch (e) {
      toast.error('Upload failed', e instanceof Error ? e.message : undefined)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
      {tools.map((t) => (
        <button key={t.label} type="button" onClick={t.run} title={t.label} aria-label={t.label} className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900">
          <t.icon className="h-4 w-4" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="Insert image"
        aria-label="Insert image"
        disabled={uploading}
        className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  )
}

const TagInput: React.FC<{ label: string; hint?: string; values: string[]; onChange: (v: string[]) => void }> = ({ label, hint, values, onChange }) => {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim().replace(/^#/, '')
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v])
    setDraft('')
  }
  return (
    <Field label={label} hint={hint}>
      {(a) => (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-ink-200 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-ink-800">
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="rounded-full p-0.5 hover:bg-ink-200">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            {...a}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add()
              } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1))
            }}
            onBlur={add}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
          />
        </div>
      )}
    </Field>
  )
}

const FaqEditor: React.FC<{ items: FaqItem[]; onChange: (v: FaqItem[]) => void; error?: string }> = ({ items, onChange, error }) => {
  const update = (i: number, patch: Partial<FaqItem>) => onChange(items.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink-900">FAQ</h2>
          <p className="text-sm text-ink-500">Shown under the article and published as FAQ data for Google and AI answers. Use real questions; answer in 1–3 sentences.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...items, { q: '', a: '' }])}>
          Add question
        </Button>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      <ol className="mt-4 space-y-4">
        {items.map((f, i) => (
          <li key={i} className="rounded-xl border border-ink-200 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-right text-sm font-semibold text-ink-400">{i + 1}</span>
              <div className="flex-1 space-y-2">
                <input aria-label={`Question ${i + 1}`} value={f.q} onChange={(e) => update(i, { q: e.target.value })} placeholder="Question" className={cn(controlClass, 'font-medium')} />
                <textarea aria-label={`Answer ${i + 1}`} value={f.a} onChange={(e) => update(i, { a: e.target.value })} placeholder="Answer" rows={2} className={controlClass} />
              </div>
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-red-700">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

const SeoPanel: React.FC<{
  post: AdminPost
  set: <K extends keyof AdminPost>(key: K, value: AdminPost[K]) => void
  rendered: Rendered | null
  errors: Record<string, string>
}> = ({ post, set, rendered, errors }) => {
  const title = post.seo_title || (post.title ? `${post.title} | Eventlaya` : '')
  const kw = post.focus_keyword.trim().toLowerCase()
  const html = rendered?.html ?? ''
  const firstPara = (html.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g, '').toLowerCase()
  const headings = Array.from(html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)).map((m) => m[1].replace(/<[^>]+>/g, '').toLowerCase())
  const kwSlug = kw.replace(/[^a-z0-9]+/g, '-')
  const checks = kw
    ? [
        { ok: title.toLowerCase().includes(kw), label: 'Focus keyword in the title' },
        { ok: post.excerpt.toLowerCase().includes(kw), label: 'In the description' },
        { ok: post.slug.includes(kwSlug) || kwSlug.split('-').every((w) => post.slug.includes(w)), label: 'In the address' },
        { ok: firstPara.includes(kw), label: 'In the first paragraph' },
        { ok: headings.some((h) => h.includes(kw)), label: 'In a section heading' },
      ]
    : []
  const general = [
    { ok: (rendered?.word_count ?? 0) >= 700, label: `Length: ${rendered?.word_count ?? 0} words (700+ for a full guide)` },
    { ok: headings.length >= 3, label: `${headings.length} section headings (3+ helps scanning)` },
    { ok: post.faq.length >= 3, label: `${post.faq.length} FAQ answers (3–6 recommended)` },
    { ok: /\]\(\/(blog|pricing|events|marketplace)/.test(post.body), label: 'Links to other Eventlaya pages' },
  ]
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold text-ink-900">Search &amp; sharing</h2>
      <div className="rounded-xl border border-ink-200 bg-white p-4" aria-label="Google result preview">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Google preview</p>
        <p className="mt-2 truncate text-xs text-ink-600">eventlaya.com › blog › {post.slug || 'your-article'}</p>
        <p className="mt-0.5 line-clamp-2 text-[17px] leading-snug text-[#1a0dab]">{title || 'Article title'}</p>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-600">{post.excerpt || 'Add a short description: it is what people read before clicking.'}</p>
      </div>
      <Field label="SEO title" hint="Optional. Defaults to the title + “| Eventlaya”." error={errors.seo_title}>
        {(a) => (
          <div>
            <input {...a} value={post.seo_title} onChange={(e) => set('seo_title', e.target.value)} placeholder={post.title ? `${post.title} | Eventlaya` : ''} className={controlClass} />
            <LengthMeter value={title.length} min={30} max={60} />
          </div>
        )}
      </Field>
      <Field label="Focus keyword" hint="The search you want this article to answer, e.g. “event venues in Dharan”." error={errors.focus_keyword}>
        {(a) => <input {...a} value={post.focus_keyword} onChange={(e) => set('focus_keyword', e.target.value)} className={controlClass} />}
      </Field>
      <ul className="space-y-1.5 text-sm">
        {[...checks, ...general].map((c) => (
          <li key={c.label} className={cn('flex items-start gap-2', c.ok ? 'text-ink-700' : 'text-ink-500')}>
            {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" aria-label="Not yet" />}
            {c.label}
          </li>
        ))}
      </ul>
      <Field label="Canonical URL" hint="Only if this article was first published somewhere else." error={errors.canonical_url}>
        {(a) => <input {...a} type="url" value={post.canonical_url} onChange={(e) => set('canonical_url', e.target.value)} placeholder="https://…" className={controlClass} />}
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={post.noindex} onChange={(e) => set('noindex', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
        <span>
          Hide from search engines <span className="text-ink-500">(noindex; also left out of the sitemap)</span>
        </span>
      </label>
    </Card>
  )
}

export default BlogEditorPage
