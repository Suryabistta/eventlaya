import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Clock, Languages, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isApiError } from '@/services/api'
import { ErrorState, Skeleton } from '@/components/ui'
import { LogoMark } from '@/components/ui/Logo'
import { SITE_URL } from '@/lib/legal'
import { useActiveSection } from '@/pages/legal/LegalPage'
import { blogApi, formatPostDate, postWords, type PostDetail, type TocItem } from './api'
import { ARTICLE_PROSE, Breadcrumbs, CtaBox, FaqList, PostCard, PostCover, ShareButtons } from './shared'

/** /blog/:slug — one article in the marketing layout, typeset like the legal pages. */
export const BlogPostPage: React.FC = () => {
  const { slug = '' } = useParams()
  const { data: post, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['blog', 'post', slug],
    queryFn: () => blogApi.post(slug),
    retry: (count, e) => !(isApiError(e) && (e.status === 404 || e.status === 403)) && count < 1,
  })

  if (isLoading) return <PostSkeleton />
  if (isError) {
    if (isApiError(error) && (error.status === 404 || error.code === 'module_disabled')) return <BlogNotFound />
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState message="We couldn’t load this article." onRetry={() => refetch()} />
      </div>
    )
  }
  return <Article post={post!} />
}

const Article: React.FC<{ post: PostDetail }> = ({ post }) => {
  const url = `${SITE_URL}/blog/${post.slug}`
  const w = postWords(post.language)
  const nepali = post.language === 'ne'
  const sections = post.toc.filter((t) => t.level === 2)
  const ids = [...sections.map((s) => s.id), ...(post.faq.length ? ['faq'] : [])]
  const active = useActiveSection(ids)
  const tocItems: TocItem[] = [...sections, ...(post.faq.length ? [{ id: 'faq', title: w.faq, level: 2 }] : [])]
  const updated = post.updated_at && post.published_at && new Date(post.updated_at).getTime() - new Date(post.published_at).getTime() > 86_400_000
  const toc = tocItems.length > 2
  const translations = post.translations ?? []

  return (
    <div className="bg-white" lang={post.language || 'en'}>
      <div className="border-b border-ink-100 bg-ink-50/70">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Blog', to: '/blog' }, { label: post.category_label, to: `/blog?category=${post.category}` }]} />
            {translations.map((t) => (
              <Link
                key={t.slug}
                to={`/blog/${t.slug}`}
                hrefLang={t.language}
                lang={t.language}
                title={t.title}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1.5 text-sm font-semibold text-brand-800 transition-colors hover:border-brand-400 hover:bg-brand-50"
              >
                <Languages className="h-4 w-4" aria-hidden />
                {postWords(t.language).readIn}
              </Link>
            ))}
          </div>
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">
            <Link to={`/blog?category=${post.category}`} className="hover:underline">
              {post.category_label}
            </Link>
          </p>
          <h1
            className={cn(
              'mt-2 max-w-4xl font-display text-[2.1rem] font-bold text-ink-900 sm:text-5xl',
              // Devanagari needs room above and below the line, and no negative tracking (it breaks the headline stroke)
              nepali ? 'leading-[1.35] sm:leading-[1.3]' : 'leading-[1.1] tracking-[-0.02em]',
            )}
          >
            {post.title}
          </h1>
          {post.excerpt && <p className="mt-4 max-w-[64ch] text-[1.0625rem] leading-relaxed text-ink-700">{post.excerpt}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-600">
            <span className="flex items-center gap-2">
              <LogoMark className="h-7 w-7 rounded-full" />
              <span>
                {w.by} <span className="font-semibold text-ink-900">{post.author_name}</span>
              </span>
            </span>
            <span>
              {w.published} <time dateTime={post.published_at ?? undefined}>{formatPostDate(post.published_at, post.language)}</time>
            </span>
            {updated && (
              <span>
                {w.updated} <time dateTime={post.updated_at}>{formatPostDate(post.updated_at, post.language)}</time>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-ink-400" aria-hidden />
              {w.minRead(post.reading_minutes)}
            </span>
            {post.cities.length > 0 && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4 text-ink-400" aria-hidden />
                {post.cities.slice(0, 4).map((c, i) => (
                  <React.Fragment key={c}>
                    {i > 0 && ', '}
                    <Link to={`/blog?city=${encodeURIComponent(c)}`} className="hover:text-ink-900 hover:underline">
                      {c}
                    </Link>
                  </React.Fragment>
                ))}
                {post.cities.length > 4 && ` +${post.cities.length - 4}`}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={cn('mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14', toc && 'lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14')}>
        {toc && (
          <>
            <details className="group mb-10 rounded-xl border border-ink-200 bg-white lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                {w.inThisGuide}
                <ChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <Toc items={tocItems} active={active} className="border-t border-ink-100 px-2 py-2" />
            </details>
            <nav aria-label={w.inThisGuide} className="hidden lg:block">
              <div className="sticky top-24">
                <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">{w.inThisGuide}</p>
                <Toc items={tocItems} active={active} className="mt-3" />
              </div>
            </nav>
          </>
        )}

        <article className="min-w-0 max-w-[70ch]">
          {post.cover_image && <PostCover post={post} eager className="mb-10 rounded-2xl" />}
          <div className={ARTICLE_PROSE} dangerouslySetInnerHTML={{ __html: post.body_html }} />

          {post.faq.length > 0 && (
            <section id="faq" aria-labelledby="faq-h" className="mt-14 scroll-mt-24 border-t border-ink-100 pt-10">
              <h2 id="faq-h" className="font-display text-[1.45rem] font-bold leading-snug tracking-[-0.01em] text-ink-900 sm:text-2xl">
                {w.faq}
              </h2>
              <FaqList items={post.faq} />
            </section>
          )}

          {post.tags.length > 0 && (
            <ul className="mt-10 flex flex-wrap gap-2" aria-label={w.topics}>
              {post.tags.map((t) => (
                <li key={t}>
                  <Link
                    to={`/blog?tag=${encodeURIComponent(t)}`}
                    className="inline-flex rounded-full bg-ink-100 px-3 py-1 text-sm font-medium text-ink-700 hover:bg-ink-200 hover:text-ink-900"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Site chrome stays English */}
          <div className="mt-8 border-t border-ink-100 pt-6" lang="en">
            <ShareButtons url={url} title={post.title} />
          </div>

          <div lang="en">
            <CtaBox />
          </div>
        </article>
      </div>

      {post.related.length > 0 && (
        <section aria-labelledby="related-h" className="border-t border-ink-100 bg-ink-50/70">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <div className="flex items-end justify-between gap-4">
              <h2 id="related-h" className="font-display text-2xl font-bold tracking-[-0.01em] text-ink-900">
                {w.keepReading}
              </h2>
              <Link to="/blog" className="text-sm font-semibold text-brand-700 hover:underline">
                {w.allGuides}
              </Link>
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {post.related.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

const Toc: React.FC<{ items: TocItem[]; active: string | null; className?: string }> = ({ items, active, className }) => (
  <ol className={cn('space-y-0.5', className)}>
    {items.map((s, i) => (
      <li key={s.id}>
        <a
          href={`#${s.id}`}
          aria-current={active === s.id ? 'location' : undefined}
          className={cn(
            'flex gap-2.5 rounded-lg px-3 py-1.5 text-sm leading-snug transition-colors',
            active === s.id ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
          )}
        >
          <span className="w-4 shrink-0 text-right tabular-nums text-ink-400">{i + 1}</span>
          <span>{s.title}</span>
        </a>
      </li>
    ))}
  </ol>
)

const PostSkeleton: React.FC = () => (
  <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" role="status" aria-label="Loading">
    <Skeleton className="h-4 w-48" />
    <Skeleton className="mt-8 h-12 w-3/4" />
    <Skeleton className="mt-4 h-5 w-2/3" />
    <div className="mt-12 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full max-w-[70ch]" />
      ))}
    </div>
  </div>
)

/** Unknown article, or the blog is switched off. */
export const BlogNotFound: React.FC = () => (
  <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
    <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">This page doesn’t exist</h1>
    <p className="mt-2 text-ink-600">The link may be old, or the article was removed.</p>
    <Link to="/" className="mt-6 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
      Go to the homepage
    </Link>
  </div>
)

export default BlogPostPage
