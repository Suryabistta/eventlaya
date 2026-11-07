import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Full-screen photo viewer: arrows / swipe / ←→ keys to move, Esc or the close button to leave.
 * Pass `index = null` to close it.
 */
export const PhotoLightbox: React.FC<{
  photos: string[]
  index: number | null
  onIndex: (i: number | null) => void
  alt?: string
}> = ({ photos, index, onIndex, alt = 'Photo' }) => {
  const open = index !== null && photos.length > 0
  const touchX = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const n = photos.length
  const go = (step: number) => index !== null && onIndex((index + step + n) % n)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  if (!open) return null
  const arrow = 'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} ${index + 1} of ${n}`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/95"
      onClick={(e) => e.target === e.currentTarget && onIndex(null)}
      onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
      onTouchEnd={(e) => {
        const start = touchX.current
        touchX.current = null
        if (start === null) return
        const dx = e.changedTouches[0]!.clientX - start
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
      }}
    >
      <img src={photos[index]} alt={`${alt} ${index + 1} of ${n}`} className="max-h-[88vh] max-w-[94vw] select-none rounded-lg object-contain" />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white tabular" aria-hidden>
        {index + 1} / {n}
      </p>
      <button ref={closeRef} type="button" aria-label="Close" onClick={() => onIndex(null)} className={cn(arrow, 'right-3 top-6 translate-y-0')}>
        <X className="h-5 w-5" />
      </button>
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => go(-1)} className={cn(arrow, 'left-3')}>
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button type="button" aria-label="Next photo" onClick={() => go(1)} className={cn(arrow, 'right-3')}>
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

/** Cover first, then the other photos without repeating it. */
export function withCover(cover: string | undefined, photos: string[] | undefined): string[] {
  const list = (photos ?? []).filter(Boolean)
  return cover ? [cover, ...list.filter((p) => p !== cover)] : list
}
