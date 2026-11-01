import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Spinner } from './ui'
import { API_BASE } from '../lib/api'

type ViewKind = 'pdf' | 'image' | 'docx' | 'unsupported'

function viewKindFor(filename: string): ViewKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image'
  if (ext === 'docx') return 'docx'
  return 'unsupported'
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/**
 * Shows a private submission file inside the app: PDFs and images natively, Word (.docx)
 * rendered in the browser. Older formats (.doc, .ppt, .pptx) fall back to a download prompt.
 */
export function FileViewerModal({
  submissionId,
  file,
  onClose,
  onDownload,
}: {
  submissionId: string
  file: { id: string; original_filename: string } | null
  onClose: () => void
  onDownload: (fileId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const docxRef = useRef<HTMLDivElement>(null)
  const kind = file ? viewKindFor(file.original_filename) : 'unsupported'

  useEffect(() => {
    if (!file || kind === 'unsupported') return
    let cancelled = false
    let url: string | null = null
    setLoading(true)
    setError(null)
    setObjectUrl(null)

    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/submissions/${submissionId}/files/${file.id}/download`, { credentials: 'include' })
        if (!res.ok) throw new Error()
        let blob = await res.blob()
        if (cancelled) return
        if (kind === 'docx') {
          const { renderAsync } = await import('docx-preview')
          if (cancelled || !docxRef.current) return
          docxRef.current.innerHTML = ''
          await renderAsync(blob, docxRef.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true })
        } else {
          // Re-type the blob so the browser renders it inline instead of offering a download.
          const ext = file.original_filename.split('.').pop()?.toLowerCase() ?? ''
          const type = kind === 'pdf' ? 'application/pdf' : (IMAGE_MIME[ext] ?? blob.type)
          blob = new Blob([blob], { type })
          url = URL.createObjectURL(blob)
          setObjectUrl(url)
        }
      } catch {
        if (!cancelled) setError('Could not open this file. Try downloading it instead.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [submissionId, file, kind])

  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title={file?.original_filename}
      size="xl"
      showClose
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {file ? (
            <Button type="button" onClick={() => onDownload(file.id)}>
              Download
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mt-4">
        {kind === 'unsupported' ? (
          <Alert variant="info">This file type can't be previewed in the browser. Download it to open it.</Alert>
        ) : error ? (
          <Alert variant="danger">{error}</Alert>
        ) : (
          <div className="relative h-[70vh] overflow-auto rounded-lg border border-border bg-surface-muted">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            ) : null}
            {kind === 'pdf' && objectUrl ? <iframe src={objectUrl} title={file?.original_filename} className="h-full w-full" /> : null}
            {kind === 'image' && objectUrl ? (
              <img src={objectUrl} alt={file?.original_filename ?? ''} className="mx-auto max-h-full max-w-full object-contain" />
            ) : null}
            {kind === 'docx' ? <div ref={docxRef} className="docx-viewer" /> : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
