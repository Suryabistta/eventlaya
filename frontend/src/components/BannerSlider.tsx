import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api, type Banner } from '@/services/api'
import { cn } from '@/lib/utils'

const AUTO_MS = 5000

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Small sliding banner (module `banners`, managed in Admin → Banners). Renders nothing when there are no
 * live slides or the module is off (the API answers 403), so pages never show an empty frame.
 * Swipe on touch (scroll snap), arrows and dots on desktop; auto-advances unless hovered, focused or
 * the user prefers reduced motion.
 */
export const BannerSlider: React.FC<{ placement: Banner['placement']; className?: string }> = ({ placement, className }) => {
  const { data: slides = [] } = useQuery({
    queryKey: ['banners', placement],
    queryFn: () => api.getBanners(placement),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const go = (i: number) => {
    const el = track.current
    if (!el || !slides.length) return
    const next = (i + slides.length) % slides.length
    el.scrollTo({ left: next * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    if (slides.length < 2 || paused || reducedMotion()) return
    const t = window.setTimeout(() => go(index + 1), AUTO_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, slides.length])

  if (!slides.length) return null

  const onScroll = () => {
    const el = track.current
    if (el && el.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      className={cn('group relative overflow-hidden rounded-2xl bg-ink-100', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        ref={track}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => {
          const img = (
            <picture>
              {s.image_mobile && <source media="(max-width: 639px)" srcSet={s.image_mobile} />}
              <img src={s.image} alt={s.title} loading={i === 0 ? 'eager' : 'lazy'} className="h-full w-full object-cover" />
            </picture>
          )
          const external = s.link.startsWith('http')
          return (
            <div
              key={s.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}`}
              // Phones: the phone image at 2:1, or the main image at its own 5:1 so nothing gets cropped
              className={cn('relative w-full shrink-0 snap-start sm:aspect-[5/1]', s.image_mobile ? 'aspect-[2/1]' : 'aspect-[5/1]')}
            >
              {s.link ? (
                external ? (
                  <a href={s.link} target="_blank" rel="noreferrer" className="block h-full">
                    {img}
                  </a>
                ) : (
                  <Link to={s.link} className="block h-full">
                    {img}
                  </Link>
                )
              ) : (
                img
              )}
            </div>
          )
        })}
      </div>

      {slides.length > 1 && (
        <>
          {(
            [
              ['Previous', -1, 'left-2', ChevronLeft],
              ['Next', 1, 'right-2', ChevronRight],
            ] as const
          ).map(([label, step, side, Icon]) => (
            <button
              key={label}
              type="button"
              aria-label={`${label} slide`}
              onClick={() => go(index + step)}
              className={cn(
                'absolute top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-800 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 sm:flex sm:opacity-0 sm:group-hover:opacity-100',
                side,
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          ))}
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className={cn('h-2 rounded-full transition-all', i === index ? 'w-5 bg-white' : 'w-2 bg-white/60 hover:bg-white/80')}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
