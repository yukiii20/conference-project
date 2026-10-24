import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Keyboard,
  Search,
  Upload,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { extractCheckinToken } from '../../lib/qrDecode'
import { decodeQrImageFile, imageFileFromClipboard, QrImageError, ACCEPTED_QR_IMAGE_TYPES } from '../../lib/qrImageDecode'
import { formatKathmanduTime } from '../../lib/datetime'
import { Alert, Button, Input } from '../ui'
import { Icon } from '../ui/Icon'
import { StatusChip } from '../ui/Badge'
import { toneBannerClasses, type StatusTone } from '../../lib/status'

type CheckinLookupResult = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  already_checked_in_today: boolean
  checked_in_at: string | null
  can_confirm: boolean
}

type SearchResult = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: string
}

export type CheckInScope = { type: 'conference' } | { type: 'session'; sessionId: string }

function endpointsFor(conferenceId: string, scope: CheckInScope) {
  const base = scope.type === 'session' ? `/conferences/${conferenceId}/sessions/${scope.sessionId}` : `/conferences/${conferenceId}`
  return {
    checkinQr: `${base}/checkin`,
    checkinManual: `${base}/checkin/manual`,
    lookup: `/conferences/${conferenceId}/registrations/lookup`,
    search: `/conferences/${conferenceId}/registrations/search`,
    confirm: (registrationId: string) => `/conferences/${conferenceId}/registrations/${registrationId}/confirm`,
  }
}

type CheckInTab = 'scan' | 'upload' | 'code'
const TAB_STORAGE_KEY = 'checkin-last-tab'

function readStoredTab(): CheckInTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v === 'scan' || v === 'upload' || v === 'code') return v
  } catch {
    // localStorage unavailable (private browsing, etc.) — just default below
  }
  return 'scan'
}

function storeTab(tab: CheckInTab): void {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // ignore — remembering the tab is a nicety, not a requirement
  }
}

const TABS: Array<{ id: CheckInTab; label: string; icon: LucideIcon }> = [
  { id: 'scan', label: 'Scan with camera', icon: Camera },
  { id: 'upload', label: 'Upload QR image', icon: Upload },
  { id: 'code', label: 'Enter ticket code', icon: Keyboard },
]

function canCheckIn(result: CheckinLookupResult): boolean {
  return result.status === 'confirmed' && !result.already_checked_in_today
}

/** Maps a session check-in failure (ConflictError 409 = already checked in, BadRequestError 400 = not confirmed/cancelled, NotFoundError 404 = unknown) to the right tone/icon, reusing the server's own message text. */
function sessionErrorBanner(err: unknown): { tone: StatusTone; icon: LucideIcon; title: string; message: string } {
  const message = err instanceof ApiError ? err.message : 'Could not check this person in.'
  if (err instanceof ApiError && err.status === 409) {
    return { tone: 'warning', icon: AlertTriangle, title: 'Already checked in', message }
  }
  return { tone: 'danger', icon: XCircle, title: 'Not checked in', message }
}

/** The one colour+icon+message block every tab's result renders into — see Step 10 spec: "all three show the same result panel". */
function ResultPanel({
  result,
  justCheckedIn,
  notFound,
  busy,
  onCheckIn,
  onConfirm,
}: {
  result: CheckinLookupResult | null
  justCheckedIn: boolean
  notFound: string | null
  busy: boolean
  onCheckIn: () => void
  onConfirm: () => void
}) {
  if (notFound) {
    return (
      <StatusBanner tone="danger" icon={XCircle} title="Not found" message={notFound} />
    )
  }
  if (!result) return null

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-semibold text-text">{result.full_name}</p>
        <p className="text-sm text-text-muted">
          {result.registration_number} · {result.category_name}
        </p>
      </div>
      <StatusChip status={result.status} />
    </div>
  )

  if (result.status === 'cancelled') {
    return (
      <div className="space-y-3">
        {header}
        <StatusBanner tone="danger" icon={XCircle} title="Cancelled" message="This registration has been cancelled." />
      </div>
    )
  }

  if (result.status === 'pending' || result.status === 'waitlisted') {
    const pending = result.status === 'pending'
    return (
      <div className="space-y-3">
        {header}
        <StatusBanner
          tone="warning"
          icon={Clock}
          title={pending ? 'Payment pending' : 'Waitlisted'}
          message={pending ? 'Confirm registration first.' : 'This registration is waitlisted, not confirmed yet.'}
        />
        {pending && result.can_confirm ? (
          <Button type="button" size="sm" onClick={onConfirm} loading={busy}>
            Confirm registration
          </Button>
        ) : null}
      </div>
    )
  }

  if (justCheckedIn) {
    return (
      <div className="space-y-3">
        {header}
        <StatusBanner tone="success" icon={CheckCircle2} title="Checked in" message="This person has been checked in." />
      </div>
    )
  }

  if (result.already_checked_in_today) {
    return (
      <div className="space-y-3">
        {header}
        <StatusBanner
          tone="warning"
          icon={AlertTriangle}
          title="Already checked in today"
          message={result.checked_in_at ? `Checked in today at ${formatKathmanduTime(result.checked_in_at)}.` : 'Already checked in today.'}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {header}
      <StatusBanner tone="info" icon={UserCheck} title="Ready to check in" message="Confirmed, not yet checked in today." />
      <Button type="button" size="sm" onClick={onCheckIn} loading={busy}>
        Check in
      </Button>
    </div>
  )
}

function StatusBanner({ tone, icon, title, message }: { tone: StatusTone; icon: LucideIcon; title: string; message: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-md border px-4 py-3 ${toneBannerClasses(tone)}`}>
      <Icon icon={icon} size={22} className="mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm">{message}</p>
      </div>
    </div>
  )
}

/**
 * Shared by the convenor/manager Attendance tab, the staff check-in page,
 * and (session-scoped) the session chair's "check attendees into this
 * session" panel. Three ways to identify someone (scan the camera, upload a
 * QR image, type a ticket code) all funnel into the same lookup+result-panel
 * flow, so the outcome always looks the same regardless of how staff found
 * the person.
 */
export function CheckInPanel({
  conferenceId,
  scope = { type: 'conference' },
  onCheckedIn,
}: {
  conferenceId: string
  scope?: CheckInScope
  /** Called after a successful check-in — lets a parent (e.g. the staff check-in desk) refresh its counts/recent-check-ins list. */
  onCheckedIn?: () => void
}) {
  const isSessionScope = scope.type === 'session'
  const [tab, setTab] = useState<CheckInTab>(readStoredTab)
  const [verifyOnly, setVerifyOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckinLookupResult | null>(null)
  const [justCheckedIn, setJustCheckedIn] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  // Session-scoped check-in (the session chair's "mark attendees into this
  // session" panel) can't use the conference-wide lookup/verify flow below —
  // a chair has permission to check people into their own session, but not
  // the conference-wide `attendance.record` permission the lookup endpoint
  // requires (see registration/routes.ts). So that scope gets a simpler,
  // direct check-in with its own plain result banner instead.
  const [simpleResult, setSimpleResult] = useState<{ tone: StatusTone; icon: LucideIcon; title: string; message: string } | null>(
    null,
  )

  const endpoints = endpointsFor(conferenceId, scope)

  function selectTab(next: CheckInTab) {
    setTab(next)
    storeTab(next)
  }

  function clearResult() {
    setResult(null)
    setJustCheckedIn(false)
    setNotFound(null)
  }

  async function lookupByQrToken(token: string): Promise<CheckinLookupResult | null> {
    try {
      return await api.get<CheckinLookupResult>(endpoints.lookup, { qr_token: token })
    } catch (err) {
      setNotFound(err instanceof ApiError ? err.message : 'Could not look this up.')
      return null
    }
  }

  async function lookupByCode(code: string): Promise<CheckinLookupResult | null> {
    try {
      return await api.get<CheckinLookupResult>(endpoints.lookup, { code })
    } catch (err) {
      setNotFound(err instanceof ApiError ? err.message : 'Could not look this up.')
      return null
    }
  }

  /** Session scope: no lookup/verify-only, just a direct check-in call and a plain success/error banner — same as before this rewrite. */
  async function handleSessionToken(token: string) {
    setBusy(true)
    setSimpleResult(null)
    try {
      const res = await api.post<{ full_name: string }>(endpoints.checkinQr, { qr_token: token })
      setSimpleResult({ tone: 'success', icon: CheckCircle2, title: 'Checked in', message: `Checked in: ${res.full_name}` })
      onCheckedIn?.()
    } catch (err) {
      setSimpleResult(sessionErrorBanner(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSessionManualCheckin(registrationId: string) {
    setBusy(true)
    setSimpleResult(null)
    try {
      const res = await api.post<{ full_name: string }>(endpoints.checkinManual, { registration_id: registrationId })
      setSimpleResult({ tone: 'success', icon: CheckCircle2, title: 'Checked in', message: `Checked in: ${res.full_name}` })
      onCheckedIn?.()
    } catch (err) {
      setSimpleResult(sessionErrorBanner(err))
    } finally {
      setBusy(false)
    }
  }

  /** Scan/Upload: decode -> lookup -> (unless Verify only, or not eligible) auto check-in. */
  async function handleDecodedToken(token: string) {
    if (isSessionScope) {
      await handleSessionToken(token)
      return
    }
    setBusy(true)
    clearResult()
    try {
      const found = await lookupByQrToken(token)
      if (!found) return
      if (verifyOnly || !canCheckIn(found)) {
        setResult(found)
        return
      }
      try {
        await api.post(endpoints.checkinQr, { qr_token: token })
        setResult(found)
        setJustCheckedIn(true)
        onCheckedIn?.()
      } catch {
        // Race (someone else checked them in between the lookup and this
        // call, or their status changed) — fall back to showing the truth.
        const fresh = await lookupByQrToken(token)
        if (fresh) setResult(fresh)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckInNow() {
    if (!result) return
    setBusy(true)
    try {
      await api.post(endpoints.checkinManual, { registration_id: result.id })
      setJustCheckedIn(true)
      onCheckedIn?.()
    } catch (err) {
      setNotFound(null)
      // Refresh from the lookup endpoint so the panel reflects reality
      // (e.g. someone else just checked this person in).
      const fresh = result.registration_number ? await lookupByCode(result.registration_number) : null
      if (fresh) setResult(fresh)
      else setNotFound(err instanceof ApiError ? err.message : 'Could not check this person in.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmRegistration() {
    if (!result) return
    setBusy(true)
    try {
      await api.patch(endpoints.confirm(result.id))
      const fresh = await lookupByCode(result.registration_number)
      if (fresh) setResult(fresh)
    } catch (err) {
      setNotFound(err instanceof ApiError ? err.message : 'Could not confirm this registration.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((t) => {
          const isActive = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              <Icon icon={t.icon} size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {!isSessionScope ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={verifyOnly}
            onChange={(e) => setVerifyOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button"
          />
          Verify only — don't check in, just show the result
        </label>
      ) : null}

      <div className="mt-4">
        {tab === 'scan' ? <ScanTab onDecoded={handleDecodedToken} busy={busy} /> : null}
        {tab === 'upload' ? <UploadTab onDecoded={handleDecodedToken} busy={busy} onImageError={(m) => setNotFound(m)} /> : null}
        {tab === 'code' ? (
          <CodeTab
            searchUrl={endpoints.search}
            onPickResult={(r) => {
              if (isSessionScope) {
                handleSessionManualCheckin(r.id)
                return
              }
              setBusy(true)
              clearResult()
              lookupByCode(r.registration_number)
                .then((found) => {
                  if (found) setResult(found)
                })
                .finally(() => setBusy(false))
            }}
            onSubmitCode={
              isSessionScope
                ? undefined
                : (code) => {
                    setBusy(true)
                    clearResult()
                    lookupByCode(code)
                      .then((found) => {
                        if (found) setResult(found)
                      })
                      .finally(() => setBusy(false))
                  }
            }
          />
        ) : null}
      </div>

      <div className="mt-4" data-testid="checkin-result">
        {isSessionScope
          ? simpleResult && (
              <StatusBanner tone={simpleResult.tone} icon={simpleResult.icon} title={simpleResult.title} message={simpleResult.message} />
            )
          : (
            <ResultPanel
              result={result}
              justCheckedIn={justCheckedIn}
              notFound={notFound}
              busy={busy}
              onCheckIn={handleCheckInNow}
              onConfirm={handleConfirmRegistration}
            />
          )}
      </div>
    </div>
  )
}

function ScanTab({ onDecoded, busy }: { onDecoded: (token: string) => void; busy: boolean }) {
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)
  const [cameraMessage, setCameraMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  // Guards against the continuous decode loop firing again for every
  // subsequent frame while the same QR code is still in view.
  const scannedRef = useRef(false)

  useEffect(() => {
    setCameraSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  }, [])

  function stopCamera() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setCameraOn(false)
  }

  async function startCamera() {
    setCameraMessage(null)
    scannedRef.current = false
    try {
      if (!readerRef.current) readerRef.current = new BrowserQRCodeReader()
      setCameraOn(true)
      const controls = await readerRef.current.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result) => {
          if (result && !scannedRef.current) {
            scannedRef.current = true
            stopCamera()
            onDecoded(extractCheckinToken(result.getText()))
          }
        },
      )
      controlsRef.current = controls
    } catch {
      setCameraOn(false)
      setCameraMessage('Camera not available — use Upload QR image or Enter ticket code.')
    }
  }

  useEffect(() => () => stopCamera(), [])

  if (!cameraSupported) {
    return <Alert variant="info">Camera not available — use Upload QR image or Enter ticket code.</Alert>
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {cameraMessage ? (
        <div className="mb-3">
          <Alert variant="info">{cameraMessage}</Alert>
        </div>
      ) : null}
      {/* Always mounted (just hidden when off) so videoRef.current is a real
          DOM node before startCamera ever calls decodeFromConstraints. */}
      <video ref={videoRef} className={`w-full max-w-sm rounded-md bg-black ${cameraOn ? '' : 'hidden'}`} muted autoPlay playsInline />
      {cameraOn ? (
        <Button type="button" variant="secondary" size="sm" onClick={stopCamera} className="mt-2" iconLeft={<Icon icon={CameraOff} size={16} />}>
          Stop camera
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={startCamera} disabled={busy} iconLeft={<Icon icon={Camera} size={16} />}>
          Start camera
        </Button>
      )}
    </div>
  )
}

function UploadTab({
  onDecoded,
  onImageError,
  busy,
}: {
  onDecoded: (token: string) => void
  onImageError: (message: string) => void
  busy: boolean
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dropRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function handleFile(file: File) {
    const previewUrl = URL.createObjectURL(file)
    setPreview(previewUrl)
    setDecoding(true)
    try {
      const token = await decodeQrImageFile(file)
      onDecoded(token)
    } catch (err) {
      onImageError(err instanceof QrImageError ? err.message : 'Could not read this image.')
    } finally {
      setDecoding(false)
    }
  }

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    function onPaste(e: ClipboardEvent) {
      const file = imageFileFromClipboard(e)
      if (file) {
        e.preventDefault()
        handleFile(file)
      }
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={dropRef}
      tabIndex={0}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button ${
        dragOver ? 'border-brand bg-surface-muted' : 'border-border bg-surface'
      }`}
    >
      {preview ? (
        <img src={preview} alt="Uploaded QR code preview" className="mx-auto mb-3 h-32 w-32 rounded-md border border-border object-contain bg-white" />
      ) : (
        <Icon icon={Upload} size={28} className="mx-auto mb-2 text-text-muted" />
      )}
      <p className="text-sm text-text">Drag and drop a QR image here, or</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_QR_IMAGE_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        disabled={decoding || busy}
        loading={decoding}
        onClick={() => fileInputRef.current?.click()}
      >
        {decoding ? 'Reading…' : 'Choose file'}
      </Button>
      <p className="mt-2 text-xs text-text-muted">PNG, JPG or WEBP, up to 5 MB. Or click here and paste (Ctrl+V) a screenshot.</p>
    </div>
  )
}

function CodeTab({
  searchUrl,
  onPickResult,
  onSubmitCode,
}: {
  searchUrl: string
  /** Picking a result from the search-as-you-type list below — always has an id, so session scope can check in directly without the conference-wide lookup. */
  onPickResult: (result: SearchResult) => void
  /** Submitting the typed text directly as an exact ticket code (Enter / Look up). Omitted for session scope, which has no code-only lookup available to it — pick a result from the list instead. */
  onSubmitCode?: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }
      try {
        const data = await api.get<{ registrations: SearchResult[] }>(searchUrl, { q: query })
        if (!cancelled) setResults(data.registrations)
      } catch {
        if (!cancelled) setResults([])
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, searchUrl])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || !onSubmitCode) return
    setResults([])
    onSubmitCode(trimmed)
  }

  function handlePick(r: SearchResult) {
    setQuery('')
    setResults([])
    onPickResult(r)
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={onSubmitCode ? 'Ticket code (e.g. A112-R0001), name or email' : 'Name, email or ticket code'}
          className="flex-1"
          autoComplete="off"
        />
        {onSubmitCode ? (
          <Button type="submit" size="sm" iconLeft={<Icon icon={Search} size={16} />}>
            Look up
          </Button>
        ) : null}
      </form>
      {results.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>
                {r.full_name} <span className="text-text-muted">({r.registration_number}, {r.category_name})</span>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => handlePick(r)}>
                Select
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default CheckInPanel
