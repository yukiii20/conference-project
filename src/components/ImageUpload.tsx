import { useRef, useState } from 'react'
import { publicImageUrl } from '../lib/storage'
import { useIsAdminViewAsReadOnly } from '../lib/adminViewAsContext'
import { ConfirmDialog } from './ui/Modal'
import { Alert, Button } from './ui'

const DEFAULT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

type ImageUploadProps = {
  /** Lowercase noun used in button text and messages, e.g. "logo", "banner", "photo". */
  label: string
  /** Current storage path saved on the row, or null if no image is set. */
  currentPath: string | null
  /** Endpoint that accepts a POST with a multipart `file` field and returns `{ path }`. */
  uploadUrl: string
  /** Endpoint that accepts a DELETE to clear the image. */
  removeUrl: string
  /** Called with the new path once the server has saved it. */
  onSaved: (path: string) => void
  /** Called once the server has cleared the path. */
  onRemoved: () => void
  maxSizeMB: number
  aspect: 'square' | 'wide'
  /** Box size for the preview. Defaults to "md" (h-40 w-40 / h-32 w-full). "sm" is a compact h-16 w-16, square only. */
  size?: 'sm' | 'md'
  /** Accepted mime types. Defaults to PNG/JPEG/WEBP. */
  accept?: string[]
  /** Optional transform applied to the file (after validation, before upload) — e.g. crop/resize an avatar. */
  transformFile?: (file: File) => Promise<File>
  /** Button text while no image is set. Defaults to `Upload ${label}`. */
  uploadButtonText?: string
  /** Button text once an image is set. Defaults to `Replace ${label}`. */
  replaceButtonText?: string
}

async function parseJsonSafely(res: Response): Promise<{ error?: { message?: string }; path?: string } | null> {
  const isJson = res.headers.get('content-type')?.includes('application/json')
  if (!isJson) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function ImageUpload({
  label,
  currentPath,
  uploadUrl,
  removeUrl,
  onSaved,
  onRemoved,
  maxSizeMB,
  aspect,
  size = 'md',
  accept = DEFAULT_ACCEPT,
  transformFile,
  uploadButtonText,
  replaceButtonText,
}: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // The server only ever stores a randomised path, never the original
  // filename — this is the only place that name is known, so it's kept
  // around (unlike `preview`) for as long as this image stays current.
  const [fileName, setFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewObjectUrl = useRef<string | null>(null)

  const hasImage = Boolean(preview || currentPath)
  const displayUrl = preview ?? publicImageUrl(currentPath)
  const readOnly = useIsAdminViewAsReadOnly()
  const busy = uploading || removing || readOnly

  function clearPreview() {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current)
      previewObjectUrl.current = null
    }
    setPreview(null)
  }

  async function handleFile(file: File) {
    setError(null)
    setSuccess(null)

    if (!accept.includes(file.type)) {
      setError(`Use a ${accept.map((t) => t.split('/')[1]?.toUpperCase() ?? t).join(', ')} image.`)
      return
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${maxSizeMB} MB.`)
      return
    }

    clearPreview()
    const objectUrl = URL.createObjectURL(file)
    previewObjectUrl.current = objectUrl
    setPreview(objectUrl)
    setUploading(true)

    try {
      let uploadFile = file
      if (transformFile) {
        uploadFile = await transformFile(file)
      }

      const formData = new FormData()
      formData.append('file', uploadFile)
      const res = await fetch(uploadUrl, { method: 'POST', body: formData, credentials: 'include' })
      const data = await parseJsonSafely(res)
      if (!res.ok || !data?.path) {
        throw new Error(data?.error?.message ?? 'Upload failed. Please try again.')
      }

      onSaved(data.path)
      setSuccess(`${capitalize(label)} updated.`)
      setFileName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      clearPreview()
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const [confirmingRemove, setConfirmingRemove] = useState(false)

  function handleRemove() {
    if (!currentPath) return
    setConfirmingRemove(true)
  }

  async function confirmRemove() {
    setConfirmingRemove(false)
    setError(null)
    setSuccess(null)
    setRemoving(true)

    try {
      const res = await fetch(removeUrl, { method: 'DELETE', credentials: 'include' })
      const data = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Could not remove this image.')
      }
      onRemoved()
      setSuccess(`${capitalize(label)} removed.`)
      setFileName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this image.')
    } finally {
      setRemoving(false)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (readOnly) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const boxSize = size === 'sm' ? 'h-16 w-16' : aspect === 'square' ? 'h-40 w-40' : 'h-32 w-full'
  const iconSize = size === 'sm' ? 18 : 28

  const box = (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!readOnly) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex shrink-0 ${boxSize} items-center justify-center overflow-hidden rounded-lg border border-dashed bg-surface ${
        dragOver ? 'border-button bg-button/5' : 'border-border'
      }`}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={`Current ${label}`}
          className={aspect === 'square' ? 'max-h-full max-w-full object-contain p-1' : 'h-full w-full object-cover'}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-text-muted">
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {size === 'sm' ? null : <span className="text-sm">No image yet</span>}
        </div>
      )}
    </div>
  )

  const resolvedUploadText = uploadButtonText ?? `Upload ${label}`
  const resolvedReplaceText = replaceButtonText ?? `Replace ${label}`
  // The server only ever returns a randomised storage path, never the
  // original filename, so once a page reload drops `fileName` this falls
  // back to that path's own basename rather than showing nothing at all.
  const displayName = fileName ?? (currentPath ? currentPath.split('/').pop() ?? null : null)

  const controls = (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          onChange={onInputChange}
          disabled={busy}
          className="hidden"
        />
        {/* The button's own visible text (Upload.../Replace...) is its accessible
            name and updates with state, so no separate aria-label is needed — same
            keyboard-focusable trigger pattern as the supporter-logo/speaker-photo uploaders. */}
        <Button type="button" size="sm" loading={uploading} onClick={() => inputRef.current?.click()} disabled={busy}>
          {hasImage ? resolvedReplaceText : resolvedUploadText}
        </Button>
        {currentPath ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={removing}
            onClick={handleRemove}
            disabled={busy}
            aria-label={`Remove ${label}`}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {hasImage && displayName ? <p className="truncate text-xs text-text-muted">{displayName}</p> : null}
    </div>
  )

  const messages = (
    <>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
    </>
  )

  const removeConfirmDialog = (
    <ConfirmDialog
      open={confirmingRemove}
      title={`Remove this ${label}?`}
      message="This can't be undone."
      confirmLabel="Remove"
      busy={removing}
      onConfirm={confirmRemove}
      onCancel={() => setConfirmingRemove(false)}
    />
  )

  if (size === 'sm') {
    return (
      <div className="flex flex-1 flex-wrap items-start gap-3">
        {box}
        <div className="min-w-[160px] flex-1 space-y-2">
          {messages}
          {controls}
        </div>
        {removeConfirmDialog}
      </div>
    )
  }

  return (
    <div className={aspect === 'square' ? 'w-40 space-y-3' : 'w-full space-y-3'}>
      {messages}
      {box}
      {controls}
      {removeConfirmDialog}
    </div>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
