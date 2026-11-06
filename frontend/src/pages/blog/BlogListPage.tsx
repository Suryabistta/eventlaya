import React, { useEffect, useState } from 'react'
import { useTrackSearch } from '@/lib/analytics'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isApiError } from '@/services/api'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { blogApi } from './api'
import { Breadcrumbs, PostCard } from './shared'
import { BlogNotFound } from './BlogPostPage'

/** /blog — guides with search, category, city and tag filters (all in the URL so filtered views are linkable). */
export const BlogListPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  useTrackSearch(search, 'blog')
  const category = params.get('category') ?? ''
  const tag = params.get('tag') ?? ''
  const city = params.get('city') ?? ''
  const lang = params.get('lang') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [draft, setDraft] = useState(search)
  useEffect(() => setDraft(search), [search])

  const posts = useQuery({
    queryKey: ['blog', 'posts', { search, category, tag, city, lang, page }],
    queryFn: () => blogApi.posts({ search, category, tag, city, lang, page }),
    placeholderData: (prev) => prev,
  })
  const topics = useQuery({ queryKey: ['blog', 'topics'], queryFn: blogApi.topics, staleTime: 5 * 60_000 })

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }
  const filtered = Boolean(search || category || tag || city || lang)
  const languages = topics.data?.languages ?? []

  if (posts.isError && (isApiError(posts.error) && (posts.error.status === 404 || posts.error.code === 'module_disabled'))) {
    return <BlogNotFound />
  }

  const chip = (active: boolean) =>
    cn(
      'inline-flex whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
      active ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:text-ink-900',
    )
  const results = posts.data?.results ?? []
  const featured = !filtered && page === 1 ? results[0] : undefined
  const rest = featured ? results.slice(1) : results

  return (
    <div className="bg-white">
      <div className="border-b border-ink-100 bg-ink-50/70">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
          <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Blog' }]} />
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">Eventlaya blog</p>
          <h1 className="mt-2 max-w-3xl font-display text-[2.1rem] font-bold leading-[1.1] tracking-[-0.02em] text-ink-900 sm:text-5xl">
            Guides for running events in Eastern Nepal
          </h1>
          <p className="mt-4 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink-700">
            Registration, tickets, gate check-in, venues and voting — practical guides for organizers in Biratnagar, Itahari, Dharan and
            across Koshi Province.
          </p>
          <form
            role="search"
            className="mt-6 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              update({ search: draft.trim() })
            }}
          >
            <label htmlFor="blog-search" className="sr-only">
              Search the blog
            </label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="blog-search"
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search guides, e.g. QR tickets"
                className="block h-11 w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <button type="submit" className="h-11 rounded-[10px] bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800">
              Search
            </button>
          </form>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
              <li>
                <Link to="/blog" className={chip(!category)} onClick={(e) => (e.preventDefault(), update({ category: '' }))}>
                  All guides
                </Link>
              </li>
              {(topics.data?.categories ?? []).map((c) => (
                <li key={c.slug}>
                  <Link
                    to={`/blog?category=${c.slug}`}
                    className={chip(category === c.slug)}
                    onClick={(e) => (e.preventDefault(), update({ category: c.slug }))}
                  >
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {languages.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="blog-lang" className="text-sm font-medium text-ink-700">
                  Language
                </label>
                <select
                  id="blog-lang"
                  value={lang}
                  onChange={(e) => update({ lang: e.target.value })}
                  className="h-10 rounded-[10px] border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All languages</option>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code} lang={l.code}>
                      {l.code === 'ne' ? 'नेपाली (Nepali)' : l.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(topics.data?.cities.length ?? 0) > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="blog-city" className="text-sm font-medium text-ink-700">
                  City
                </label>
                <select
                  id="blog-city"
                  value={city}
                  onChange={(e) => update({ city: e.target.value })}
                  className="h-10 rounded-[10px] border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All of Eastern Nepal</option>
                  {topics.data!.cities.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {filtered && (
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span>
              {posts.data ? `${posts.data.count} ${posts.data.count === 1 ? 'guide' : 'guides'}` : 'Guides'}
              {search && <> matching “{search}”</>}
              {tag && <> tagged “{tag}”</>}
              {city && <> for {city}</>}
              {lang && <> in {lang === 'ne' ? 'Nepali' : 'English'}</>}
            </span>
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams())}
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-700 hover:bg-ink-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
            </button>
          </div>
        )}

        <h2 className="sr-only">Articles</h2>
        {posts.isLoading ? (
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-80 rounded-2xl" />
            ))}
          </div>
        ) : posts.isError ? (
          <div className="mt-8">
            <ErrorState message="We couldn’t load the guides." onRetry={() => posts.refetch()} />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<Search className="h-6 w-6" />}
            title="No guides match"
            description="Try another word, or clear the filters to see every guide."
          />
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featured && <PostCard post={featured} featured />}
            {rest.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        )}

        {posts.data && posts.data.pages > 1 && (
          <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-3">
            {page > 1 && (
              <button type="button" onClick={() => update({ page: String(page - 1) })} className={chip(false)}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Newer
              </button>
            )}
            <span className="text-sm text-ink-600">
              Page {page} of {posts.data.pages}
            </span>
            {page < posts.data.pages && (
              <button type="button" onClick={() => update({ page: String(page + 1) })} className={chip(false)}>
                Older <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              </button>
            )}
          </nav>
        )}

        {(topics.data?.tags.length ?? 0) > 0 && (
          <section aria-labelledby="blog-topics" className="mt-14 border-t border-ink-100 pt-8">
            <h2 id="blog-topics" className="text-sm font-semibold text-ink-900">
              Popular topics
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {topics.data!.tags.map((t) => (
                <li key={t.name}>
                  <Link
                    to={`/blog?tag=${encodeURIComponent(t.name)}`}
                    onClick={(e) => (e.preventDefault(), update({ tag: tag === t.name ? '' : t.name }))}
                    className={chip(tag.toLowerCase() === t.name.toLowerCase())}
                  >
                    #{t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

export default BlogListPage
