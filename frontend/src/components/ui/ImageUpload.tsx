import React, { useId, useRef, useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Star, Trash2, ChevronLeft, ChevronRight, UploadCloud } from 'lucide-react'
import { tokenStore } from '@/services/api'
import { cn } from '@/lib/utils'
import { useToast } from './Toast'

export type UploadKind = 'logo' | 'banner' | 'venue' | 'space' | 'vendor' | 'avatar' | 'chat' | 'contestant' | 'blog' | 'misc'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_BYTES = 5 * 1024 * 1024

function validate(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return `${file.name} isn’t a JPG, PNG, WebP or GIF image.`
  if (file.size > MAX_BYTES) return `${file.name} is larger than 5 MB.`
  return null
}

/** Uploads one image to /api/uploads/ and reports progress (0–100). */
export function uploadImage(file: File, kind: UploadKind, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = new FormData()
    body.append('file', file)
    body.append('kind', kind)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads/')
    const token = tokenStore.access
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let data: { url?: string; error?: string; detail?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data.url)
      else if (xhr.status === 401) reject(new Error('Your session ended. Sign in again to upload.'))
      else reject(new Error(data.error || data.detail || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.send(body)
  })
}

const dropzoneBase =
  'relative flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500/30'

/* ------------------------------------------------------------------ */

interface ImageUploadProps {
  label: string
  value: string | null | undefined
  onChange: (url: string | null) => void
  kind: UploadKind
  hint?: string
  /** "square" for logos and avatars, "wide" for banners and photos */
  shape?: 'square' | 'wide'
  className?: string
}

/** One image: drop or choose a file, see it, replace or remove it. */
export const ImageUpload: React.FC<ImageUploadProps> = ({ label, value, onChange, kind, hint, shape = 'wide', className }) => {
  const toast = useToast()
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [broken, setBroken] = useState(false)

  const handle = async (file: File | undefined) => {
    if (!file) return
    const problem = validate(file)
    if (problem) {
      toast.error('Couldn’t use that image', problem)
      return
    }
    setProgress(0)
    try {
      const url = await uploadImage(file, kind, setProgress)
      setBroken(false)
      onChange(url)
      toast.success(`${label} uploaded`)
    } catch (e) {
      toast.error('Upload failed', (e as Error).message)
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const uploading = progress !== null
  const square = shape === 'square'

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handle(e.dataTransfer.files[0])
        }}
        className={cn('flex gap-4', square ? 'items-center' : 'flex-col')}
      >
        {value && !uploading ? (
          <div
            className={cn(
              'relative shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-ink-50',
              square ? 'h-24 w-24' : 'aspect-[16/7] w-full',
              dragging && 'ring-2 ring-brand-500',
            )}
          >
            {broken ? (
              <div className="flex h-full items-center justify-center text-xs text-ink-500">Can’t show this image</div>
            ) : (
              <img src={value} alt="" className={cn('h-full w-full', square ? 'object-contain p-2' : 'object-cover')} onError={() => setBroken(true)} />
            )}
          </div>
        ) : (
          <div
            className={cn(
              dropzoneBase,
              square ? 'h-24 w-24 shrink-0 px-2' : 'aspect-[16/6] min-h-[140px]',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-ink-50 hover:border-brand-300 hover:bg-brand-50/40',
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
                <span className="text-xs font-medium text-ink-700 tabular">{progress}%</span>
              </>
            ) : (
              <>
                {square ? <ImagePlus className="h-6 w-6 text-brand-600" aria-hidden /> : <UploadCloud className="h-7 w-7 text-brand-600" aria-hidden />}
                {!square && (
                  <p className="text-sm text-ink-700">
                    <span className="font-semibold text-brand-700">Choose an image</span> or drag it here
                  </p>
                )}
              </>
            )}
            <input
              ref={inputRef}
              id={id}
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(e) => handle(e.target.files?.[0])}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
              aria-describedby={`${id}-hint`}
            />
          </div>
        )}

        <div className={cn('flex flex-wrap items-center gap-2', square ? '' : '')}>
          {value && !uploading && (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-ink-200 bg-white px-3 text-[13px] font-semibold text-ink-800 shadow-2xs hover:bg-ink-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove
              </button>
              <input ref={inputRef} id={id} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => handle(e.target.files?.[0])} />
            </>
          )}
          {square && !value && !uploading && (
            <p className="text-sm text-ink-600">
              <span className="font-semibold text-brand-700">Choose an image</span> or drag it onto the box
            </p>
          )}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-xs text-ink-500">
        {hint || 'JPG, PNG, WebP or GIF, up to 5 MB.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface GalleryProps {
  label: string
  value: string[]
  onChange: (urls: string[]) => void
  kind: UploadKind
  max?: number
  hint?: string
  className?: string
}

/** Several images: add many at once, reorder, pick the cover (first), remove. */
export const ImageGalleryUpload: React.FC<GalleryProps> = ({ label, value, onChange, kind, max = 8, hint, className }) => {
  const toast = useToast()
  const id = useId()
  const [pending, setPending] = useState<{ key: string; name: string; progress: number }[]>([])
  const [dragging, setDragging] = useState(false)
  const latest = useRef(value)
  latest.current = value

  const room = max - value.length - pending.length

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    if (list.length > room) toast.info(`Only ${max} images allowed`, `Added the first ${Math.max(room, 0)}.`)
    const accepted = list.slice(0, Math.max(room, 0)).filter((f) => {
      const problem = validate(f)
      if (problem) toast.error('Skipped a file', problem)
      return !problem
    })
    let added = 0
    await Promise.all(
      accepted.map(async (file) => {
        const key = `${file.name}-${Math.random().toString(36).slice(2)}`
        setPending((p) => [...p, { key, name: file.name, progress: 0 }])
        try {
          const url = await uploadImage(file, kind, (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: pct } : x))))
          latest.current = [...latest.current, url]
          onChange(latest.current)
          added++
        } catch (e) {
          toast.error(`Couldn’t upload ${file.name}`, (e as Error).message)
        } finally {
          setPending((p) => p.filter((x) => x.key !== key))
        }
      }),
    )
    if (added) toast.success(added === 1 ? 'Photo uploaded' : `${added} photos uploaded`)
  }

  const move = (i: number, dir: -1 | 1) => {
    const next = [...value]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <p id={`${id}-label`} className="text-sm font-medium text-ink-800">
        {label}
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        className={cn('grid grid-cols-2 gap-3 rounded-xl sm:grid-cols-3 xl:grid-cols-4', dragging && 'ring-2 ring-brand-500 ring-offset-4')}
        role="group"
        aria-labelledby={`${id}-label`}
      >
        {value.map((url, i) => (
          <figure key={url} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
            <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-ink-900 shadow-xs">
                <Star className="h-3 w-3 fill-marigold-400 text-marigold-500" aria-hidden />
                Cover
              </span>
            )}
            <div className="absolute inset-x-2 bottom-2 flex justify-between gap-1">
              <div className="flex gap-1">
                <GalleryButton label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronLeft className="h-4 w-4" />
                </GalleryButton>
                <GalleryButton label={`Move photo ${i + 1} later`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                  <ChevronRight className="h-4 w-4" />
                </GalleryButton>
              </div>
              <div className="flex gap-1">
                {i !== 0 && (
                  <GalleryButton label={`Make photo ${i + 1} the cover`} onClick={() => onChange([url, ...value.filter((u) => u !== url)])}>
                    <Star className="h-4 w-4" />
                  </GalleryButton>
                )}
                <GalleryButton label={`Remove photo ${i + 1}`} danger onClick={() => onChange(value.filter((u) => u !== url))}>
                  <Trash2 className="h-4 w-4" />
                </GalleryButton>
              </div>
            </div>
          </figure>
        ))}

        {pending.map((p) => (
          <div key={p.key} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
            <span className="w-full truncate text-xs text-ink-600">{p.name}</span>
            <div className="h-1 w-full overflow-hidden rounded-full bg-ink-200">
              <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${p.progress}%` }} />
            </div>
          </div>
        ))}

        {room > 0 && (
          <div
            className={cn(
              dropzoneBase,
              'aspect-[4/3]',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-brand-300 hover:bg-brand-50/40',
            )}
          >
            <ImagePlus className="h-6 w-6 text-brand-600" aria-hidden />
            <span className="text-sm font-semibold text-brand-700">Add photos</span>
            <span className="text-xs text-ink-500">or drop them here</span>
            <input
              id={id}
              type="file"
              accept={ACCEPT}
              multiple
              aria-label={`Add photos to ${label}`}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </div>
        )}
      </div>
      <p className="text-xs text-ink-500">
        {hint || `Up to ${max} images, 5 MB each. The first one is the cover.`} {value.length}/{max} added.
      </p>
    </div>
  )
}

const GalleryButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }> = ({
  label,
  onClick,
  disabled,
  danger,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 shadow-xs transition-colors disabled:opacity-40',
      danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-white',
    )}
  >
    {children}
  </button>
)
