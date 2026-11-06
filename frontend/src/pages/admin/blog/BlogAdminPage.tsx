import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText, Plus, Search } from 'lucide-react'
import { Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { blogApi, formatPostDate, type AdminPost, type BlogStatus } from '@/pages/blog/api'
import { PAGE, Segmented, timeAgo } from '../shared'

type Filter = 'all' | BlogStatus

export const STATUS_BADGE: Record<BlogStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  published: { label: 'Published', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'warning' },
  draft: { label: 'Draft', tone: 'neutral' },
}

export const PostStatusBadge: React.FC<{ post: Pick<AdminPost, 'status' | 'is_live' | 'published_at'> }> = ({ post }) => {
  const s = STATUS_BADGE[post.status]
  return <Badge tone={post.status === 'scheduled' && post.is_live ? 'success' : s.tone}>{post.status === 'scheduled' && post.is_live ? 'Published' : s.label}</Badge>
}

/** Superadmin → Blog: every article with its state, newest edits first. */
export const BlogAdminPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const filter = (params.get('status') as Filter) || 'all'
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['blog-admin', 'list', filter],
    queryFn: () => blogApi.adminList({ status: filter === 'all' ? undefined : filter }),
  })
  const q = search.trim().toLowerCase()
  const posts = (data ?? []).filter((p) => !q || p.title.toLowerCase().includes(q) || p.slug.includes(q))

  return (
    <div className={PAGE}>
      <PageHeader
        title="Blog"
        description="Guides on eventlaya.com/blog. Published articles are in the sitemap, llms.txt and the server-rendered pages."
        actions={
          <ButtonLink to="/admin/blog/new" icon={<Plus className="h-4 w-4" />}>
            New article
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Filter articles"
          value={filter}
          onChange={(v) => setParams(v === 'all' ? {} : { status: v })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'draft', label: 'Drafts' },
          ]}
        />
        <label className="relative sm:w-72">
          <span className="sr-only">Search articles</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title"
            className="block h-10 w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
      </div>

      {isLoading ? (
        <Card className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load the articles." onRetry={() => refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={q || filter !== 'all' ? 'No articles match' : 'No articles yet'}
          description="Write a guide that answers a question organizers in Eastern Nepal actually ask."
          action={
            <ButtonLink to="/admin/blog/new" icon={<Plus className="h-4 w-4" />}>
              New article
            </ButtonLink>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/blog/${p.id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {p.title || 'Untitled'}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-ink-500">
                    /blog/{p.slug} · {p.category_label} · {p.word_count ?? 0} words
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-ink-500">
                  <PostStatusBadge post={p} />
                  <span className="w-36 text-right" title={p.updated_at ? new Date(p.updated_at).toLocaleString() : undefined}>
                    {p.status === 'draft' ? `Edited ${p.updated_at ? timeAgo(p.updated_at) : ''}` : formatPostDate(p.published_at)}
                  </span>
                  {p.is_live ? (
                    <a href={`/blog/${p.slug}`} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label={`Open ${p.title} on the site`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="w-7" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default BlogAdminPage
