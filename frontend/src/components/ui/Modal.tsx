import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

/**
 * Built on the native <dialog>: the browser handles focus trapping, Escape,
 * inert background and top-layer stacking.
 */
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, description, size = 'md', footer, children, className }) => {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    } else if (!open && dialog.open) {
      dialog.close()
    }
    return () => {
      document.documentElement.style.overflow = ''
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel)
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-visible rounded-2xl bg-transparent p-0 text-ink-900 backdrop:bg-ink-950/50 backdrop:backdrop-blur-[2px] open:animate-pop-in',
        sizes[size],
      )}
    >
      {open && (
        <div className={cn('flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-pop', className)}>
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
