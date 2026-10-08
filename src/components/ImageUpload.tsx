import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { imageExtension, publicImageUrl } from '../lib/storage'

const DEFAULT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

type ImageUploadProps = {
  /** Lowercase noun used in button text and messages, e.g. "logo", "banner", "photo". */
  label: string
  /** Current storage path saved on the row, or null if no image is set. */
  currentPath: string | null
  /** Builds the storage path for a newly chosen (and possibly transformed) file. */
  buildPath: (file: File) => string
  /** Persists the new path to the database. Return an error message, or null on success. */
  onSaved: (path: string) => Promise<string | null>
  /** Clears the path on the database (sets the column to null). Return an error message, or null on success. */
  onRemoved: () => Promise<string | null>
  maxSizeMB: number
  aspect: 'square' | 'wide'
  /** Box size for the preview. Defaults to "md" (h-40 w-40 / h-32 w-full). "sm" is a compact h-16 w-16, square only. */
  size?: 'sm' | 'md'
  /** Accepted mime types. Defaults to PNG/JPEG/WEBP. */
  accept?: string[]
  /** Optional transform applied to the file (after validation, before upload) — e.g. crop/resize an avatar. */
  transformFile?: (file: File) => Promise<File>
}

export function ImageUpload({
  label,
  currentPath,
  buildPath,
  onSaved,
  onRemoved,
  maxSizeMB,
  aspect,
  size = 'md',
  accept = DEFAULT_ACCEPT,
  transformFile,
}: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewObjectUrl = useRef<string | null>(null)

  const hasImage = Boolean(preview || currentPath)
  const displayUrl = preview ?? publicImageUrl(currentPath)
  const busy = uploading || removing

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
      setError(`Use a ${accept.map((t) => imageExtension(t)?.toUpperCase() ?? t).join(', ')} image.`)
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

    let uploadFile = file
    if (transformFile) {
      try {
        uploadFile = await transformFile(file)
      } catch (transformError) {
        setUploading(false)
        clearPreview()
        setError(transformError instanceof Error ? transformError.message : 'Could not process that image.')
        return
      }
    }

    const path = buildPath(uploadFile)
    const previousPath = currentPath

    // eslint-disable-next-line no-console
    console.group(`[ImageUpload] uploading ${label}`)
    // eslint-disable-next-line no-console
    console.log('file', { name: uploadFile.name, type: uploadFile.type, size: uploadFile.size })
    // eslint-disable-next-line no-console
    console.log('path', path)

    const { data, error: uploadError } = await supabase.storage.from('public-assets').upload(path, uploadFile, {
      cacheControl: '3600',
      upsert: false,
      contentType: uploadFile.type,
    })

    // eslint-disable-next-line no-console
    console.log('upload result', {
      data,
      error: uploadError,
      message: uploadError?.message,
      statusCode: (uploadError as unknown as { statusCode?: string })?.statusCode,
      name: uploadError?.name,
    })
    // eslint-disable-next-line no-console
    console.groupEnd()

    if (uploadError) {
      setUploading(false)
      clearPreview()
      setError(uploadError.message || 'Upload failed. See console for details.')
      return
    }

    const saveError = await onSaved(path)
    if (saveError) {
      setUploading(false)
      clearPreview()
      await supabase.storage.from('public-assets').remove([path])
      setError(saveError)
      return
    }

    if (previousPath && previousPath !== path) {
      await supabase.storage.from('public-assets').remove([previousPath])
    }

    setUploading(false)
    clearPreview()
    setSuccess(`${capitalize(label)} updated.`)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleRemove() {
    if (!currentPath) return
    if (!window.confirm('Remove this image?')) return
    setError(null)
    setSuccess(null)
    setRemoving(true)

    const removeError = await onRemoved()
    if (removeError) {
      setRemoving(false)
      setError(removeError)
      return
    }

    await supabase.storage.from('public-assets').remove([currentPath])
    setRemoving(false)
    clearPreview()
    setSuccess(`${capitalize(label)} removed.`)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const boxSize = size === 'sm' ? 'h-16 w-16' : aspect === 'square' ? 'h-40 w-40' : 'h-32 w-full'
  const iconSize = size === 'sm' ? 18 : 28

  const box = (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex shrink-0 ${boxSize} items-center justify-center overflow-hidden rounded-lg border border-dashed bg-white ${
        dragOver ? 'border-button bg-button/5' : 'border-line'
      }`}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={`Current ${label}`}
          className={aspect === 'square' ? 'max-h-full max-w-full object-contain p-1' : 'h-full w-full object-cover'}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-ink/50">
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

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        onChange={onInputChange}
        disabled={busy}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={hasImage ? `Replace ${label}` : `Upload ${label}`}
        className={`rounded-md bg-button font-medium text-white hover:opacity-90 disabled:opacity-50 ${
          size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        {uploading ? 'Uploading…' : hasImage ? `Replace ${label}` : `Upload ${label}`}
      </button>
      {currentPath ? (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          aria-label={`Remove ${label}`}
          className={`rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 ${
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          }`}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      ) : null}
    </div>
  )

  const messages = (
    <>
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      ) : null}
    </>
  )

  if (size === 'sm') {
    return (
      <div className="flex flex-1 flex-wrap items-start gap-3">
        {box}
        <div className="min-w-[160px] flex-1 space-y-2">
          {messages}
          {controls}
        </div>
      </div>
    )
  }

  return (
    <div className={aspect === 'square' ? 'w-40 space-y-3' : 'w-full space-y-3'}>
      {messages}
      {box}
      {controls}
    </div>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
