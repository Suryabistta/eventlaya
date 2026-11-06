import React, { useState } from 'react'
import { shareClickTracker } from '@/lib/analytics'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Info,
  Link2,
  MapPin,
  QrCode,
  Share2,
  Store,
  Vote,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonClass } from '@/components/ui/Button'
import { formatPostDate, type FaqItem, type PostCard as PostCardData } from './api'

/** Long-form article text: the rendered Markdown (h2/h3, lists, tables, quotes, images). Matches the legal pages. */
export const ARTICLE_PROSE = cn(
  'text-[1.0625rem] leading-[1.75] text-ink-700',
  '[&>*:first-child]:mt-0 [&_p]:mt-5',
  '[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-[1.45rem] [&_h2]:font-bold [&_h2]:leading-snug [&_h2]:tracking-[-0.01em] [&_h2]:text-ink-900 sm:[&_h2]:text-2xl',
  '[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-900',
  '[&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:text-ink-900',
  '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul_li]:pl-1 [&_ul_li::marker]:text-brand-400',
  '[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol_li]:pl-1 [&_ol_li::marker]:font-semibold [&_ol_li::marker]:text-ink-500',
  '[&_li>p]:mt-1',
  '[&_strong]:font-semibold [&_strong]:text-ink-900',
  '[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:decoration-brand-300 [&_a]:underline-offset-2 hover:[&_a]:decoration-brand-700',
  '[&_blockquote]:mt-6 [&_blockquote]:border-l-4 [&_blockquote]:border-brand-200 [&_blockquote]:bg-brand-50/50 [&_blockquote]:px-5 [&_blockquote]:py-3 [&_blockquote]:text-ink-800',
  '[&_code]:rounded [&_code]:bg-ink-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre]:mt-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-ink-900 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-ink-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-10 [&_hr]:border-ink-100',
  '[&_img]:mt-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl',
  '[&_.table-wrap]:mt-6 [&_.table-wrap]:overflow-x-auto [&_.table-wrap]:rounded-xl [&_.table-wrap]:border [&_.table-wrap]:border-ink-200',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[0.95rem]',
  '[&_th]:border-b [&_th]:border-ink-200 [&_th]:bg-ink-50 [&_th]:px-4 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-ink-900',
  '[&_td]:border-b [&_td]:border-ink-100 [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top [&_tr:last-child_td]:border-b-0',
)

const CATEGORY_ART: Record<string, { icon: LucideIcon; className: string }> = {
  guides: { icon: BookOpen, className: 'from-brand-600 to-brand-800 text-white' },
  'city-guides': { icon: MapPin, className: 'from-marigold-400 to-marigold-600 text-ink-900' },
  ticketing: { icon: QrCode, className: 'from-ink-800 to-ink-950 text-white' },
  venues: { icon: Store, className: 'from-brand-100 to-brand-200 text-brand-900' },
  voting: { icon: Vote, className: 'from-brand-500 to-marigold-500 text-white' },
  planning: { icon: ClipboardList, className: 'from-emerald-500 to-emerald-700 text-white' },
  about: { icon: Info, className: 'from-ink-100 to-ink-200 text-ink-900' },
}

export function categoryArt(category: string) {
  return CATEGORY_ART[category] ?? { icon: CalendarCheck, className: 'from-brand-600 to-brand-800 text-white' }
}

/** Cover image, or a typographic panel in the category's colours when the post has none. */
export const PostCover: React.FC<{ post: PostCardData; className?: string; eager?: boolean }> = ({ post, className, eager }) => {
  if (post.cover_image) {
    return (
      <img
        src={post.cover_image}
        alt={post.cover_alt || ''}
        width={1200}
        height={630}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className={cn('aspect-[1200/630] w-full object-cover', className)}
      />
    )
  }
  const art = categoryArt(post.category)
  return (
    <div aria-hidden className={cn('relative flex aspect-[1200/630] w-full overflow-hidden bg-gradient-to-br p-5', art.className, className)}>
      <art.icon className="absolute -bottom-6 -right-4 h-36 w-36 opacity-15" strokeWidth={1.4} />
      <div className="mt-auto">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{post.category_label}</p>
        {post.cities.length > 0 && <p className="mt-1 font-display text-lg font-bold leading-tight">{post.cities.slice(0, 3).join(' · ')}</p>}
      </div>
    </div>
  )
}

export const PostCard: React.FC<{ post: PostCardData; featured?: boolean }> = ({ post, featured }) => (
  <article
    lang={post.language || 'en'}
    className={cn(
      'group relative flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white transition-shadow hover:shadow-pop',
      featured && 'md:col-span-2 md:flex-row lg:col-span-3',
    )}
  >
    <div className={cn('overflow-hidden', featured && 'md:w-1/2 md:shrink-0')}>
      <PostCover post={post} eager={featured} className={cn('transition-transform duration-300 group-hover:scale-[1.02]', featured && 'md:h-full')} />
    </div>
    <div className={cn('flex flex-1 flex-col p-5', featured && 'md:p-8')}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">
        <span lang="en">{post.category_label}</span>
        {post.language === 'ne' && <span className="rounded-full bg-marigold-100 px-2 py-0.5 tracking-normal text-marigold-900 normal-case">नेपाली</span>}
      </p>
      <h3 className={cn('mt-2 font-display font-bold leading-snug text-ink-900', post.language !== 'ne' && 'tracking-[-0.01em]', featured ? 'text-2xl md:text-[1.9rem]' : 'text-lg')}>
        <Link to={`/blog/${post.slug}`} className="after:absolute after:inset-0 focus:outline-none">
          {post.title}
        </Link>
      </h3>
      <p className={cn('mt-2 text-sm leading-relaxed text-ink-600', featured ? 'line-clamp-4 md:text-base' : 'line-clamp-3')}>{post.excerpt}</p>
      <p className="mt-auto pt-4 text-xs text-ink-500">
        <time dateTime={post.published_at ?? undefined}>{formatPostDate(post.published_at)}</time>
        <span aria-hidden> · </span>
        {post.reading_minutes} min read
      </p>
    </div>
  </article>
)

export const Breadcrumbs: React.FC<{ items: { label: string; to?: string }[] }> = ({ items }) => (
  <nav aria-label="Breadcrumb">
    <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
      {items.map((item, i) => (
        <li key={item.label} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-300" aria-hidden />}
          {item.to ? (
            <Link to={item.to} className="hover:text-ink-900 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="truncate text-ink-700">
              {item.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  </nav>
)

export const FaqList: React.FC<{ items: FaqItem[] }> = ({ items }) => (
  <div className="mt-5 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white">
    {items.map((f) => (
      <details key={f.q} className="group px-5 py-1 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-3.5 font-semibold text-ink-900">
          <h3 className="text-base">{f.q}</h3>
          <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="pb-4 text-[1rem] leading-relaxed text-ink-700">{f.a}</p>
      </details>
    ))}
  </div>
)

export const ShareButtons: React.FC<{ url: string; title: string }> = ({ url, title }) => {
  const [copied, setCopied] = useState(false)
  const enc = encodeURIComponent
  const links = [
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${title} ${url}`)}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
  ]
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const pill = 'inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-900'
  return (
    <div className="flex flex-wrap items-center gap-2" onClickCapture={shareClickTracker('blog_post', url.split('/').filter(Boolean).pop() ?? '')}>
      <span className="mr-1 text-sm font-semibold text-ink-900">Share</span>
      {canShare && (
        <button type="button" className={pill} onClick={() => navigator.share({ title, url }).catch(() => undefined)}>
          <Share2 className="h-4 w-4" aria-hidden /> Share…
        </button>
      )}
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={pill}>
          {l.label}
        </a>
      ))}
      <button
        type="button"
        className={pill}
        onClick={() => {
          navigator.clipboard?.writeText(url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

export const CtaBox: React.FC = () => (
  <aside className="mt-14 overflow-hidden rounded-2xl bg-ink-900 p-6 text-white sm:p-8">
    <p className="font-display text-2xl font-bold tracking-[-0.01em]">Run your event on Eventlaya</p>
    <p className="mt-2 max-w-[52ch] text-ink-200">
      Registration form, QR passes and gate check-in in one place. Free for events up to 150 attendees, no card needed.
    </p>
    <div className="mt-5 flex flex-wrap gap-3">
      <Link to="/signup" className={buttonClass('primary', 'lg')}>
        Start free <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
      <Link to="/pricing" className="inline-flex items-center rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/10">
        See pricing
      </Link>
    </div>
  </aside>
)
