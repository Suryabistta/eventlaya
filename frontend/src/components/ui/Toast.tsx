import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from './Modal'
import { Button } from './Button'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
}

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ToastContext = createContext<ToastApi | null>(null)

const toneStyles: Record<ToastTone, { icon: React.ElementType; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-emerald-600' },
  error: { icon: AlertTriangle, className: 'text-red-600' },
  info: { icon: Info, className: 'text-brand-600' },
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = ++nextId.current
      setToasts((t) => [...t.slice(-3), { id, tone, title, description }])
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 4000)
    },
    [dismiss],
  )

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (t, d) => push('success', t, d),
      error: (t, d) => push('error', t, d),
      info: (t, d) => push('info', t, d),
      confirm: (options) => new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })),
    }),
    [push],
  )

  const closeConfirm = (result: boolean) => {
    confirmState?.resolve(result)
    setConfirmState(null)
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:bottom-0 sm:top-auto sm:items-end sm:p-4"
      >
        {toasts.map((t) => {
          const { icon: Icon, className } = toneStyles[t.tone]
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 shadow-pop"
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-ink-500">{t.description}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded-md p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
      <Modal
        open={Boolean(confirmState)}
        onClose={() => closeConfirm(false)}
        title={confirmState?.title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => closeConfirm(false)}>Cancel</Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)} autoFocus>
              {confirmState?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">{confirmState?.description}</p>
      </Modal>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
