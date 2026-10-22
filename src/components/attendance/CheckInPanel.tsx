import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { api, ApiError } from '../../lib/api'
import { Alert, Button, Input } from '../ui'
import { toneBannerClasses } from '../../lib/status'

type SearchResult = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: string
}

function extractQrToken(decoded: string): string {
  const match = decoded.match(/\/checkin\/([A-Za-z0-9_-]+)$/)
  return match ? match[1]! : decoded.trim()
}

export type CheckInScope = { type: 'conference' } | { type: 'session'; sessionId: string }

function endpointsFor(conferenceId: string, scope: CheckInScope) {
  const base = scope.type === 'session' ? `/conferences/${conferenceId}/sessions/${scope.sessionId}` : `/conferences/${conferenceId}`
  return { qr: `${base}/checkin`, manual: `${base}/checkin/manual` }
}

/**
 * Shared by the convenor/manager Attendance tab, the staff check-in page,
 * and (session-scoped) the session chair's "check attendees into this
 * session" panel — same backend shape either way, just a different base
 * URL. The conference-wide check-in response includes a registration
 * number; the session-scoped one doesn't (a session isn't the place that
 * number means anything), so the confirmation message adapts.
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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  // Guards against the continuous decode loop firing the check-in call
  // again for every subsequent frame while the same QR code is still in
  // view — one scan stops the camera, so the next person needs a fresh tap.
  const scannedRef = useRef(false)

  const endpoints = endpointsFor(conferenceId, scope)

  useEffect(() => {
    setCameraSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }
      try {
        const data = await api.get<{ registrations: SearchResult[] }>(`/conferences/${conferenceId}/registrations/search`, {
          q: query,
        })
        if (!cancelled) setResults(data.registrations)
      } catch {
        if (!cancelled) setResults([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [conferenceId, query])

  function describe(res: { full_name: string; registration_number?: string }): string {
    return res.registration_number ? `Checked in: ${res.full_name} (${res.registration_number})` : `Checked in: ${res.full_name}`
  }

  async function checkIn(registrationId: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ full_name: string; registration_number?: string }>(endpoints.manual, {
        registration_id: registrationId,
      })
      setMessage({ kind: 'ok', text: describe(res) })
      setQuery('')
      setResults([])
      onCheckedIn?.()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not check this person in.' })
    } finally {
      setBusy(false)
    }
  }

  async function checkInByQr(token: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ full_name: string; registration_number?: string }>(endpoints.qr, { qr_token: token })
      setMessage({ kind: 'ok', text: describe(res) })
      onCheckedIn?.()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not check this person in.' })
    } finally {
      setBusy(false)
    }
  }

  function stopCamera() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setCameraOn(false)
  }

  async function startCamera() {
    setMessage(null)
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
            checkInByQr(extractQrToken(result.getText()))
          }
        },
      )
      controlsRef.current = controls
    } catch {
      setCameraOn(false)
      setMessage({ kind: 'error', text: 'Could not access the camera. Use manual search below instead.' })
    }
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div>
      {message ? (
        <div
          className={`rounded-md border px-4 py-3 text-center text-lg font-semibold ${toneBannerClasses(
            message.kind === 'ok' ? 'success' : 'danger',
          )}`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-text">Scan a QR code</p>
        {cameraSupported ? (
          <div className="mt-2">
            {/* Always mounted (just hidden when off) so videoRef.current is a
                real DOM node before startCamera ever calls decodeFromConstraints
                — attaching the stream to a ref that doesn't exist yet is what
                caused a black box with no picture. */}
            <video
              ref={videoRef}
              className={`w-full max-w-sm rounded-md bg-black ${cameraOn ? '' : 'hidden'}`}
              muted
              autoPlay
              playsInline
            />
            {cameraOn ? (
              <Button type="button" variant="secondary" size="sm" onClick={stopCamera} className="mt-2">
                Stop camera
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={startCamera}>
                Start camera
              </Button>
            )}
          </div>
        ) : (
          <Alert variant="info">Camera scanning is not supported in this browser — use manual search below.</Alert>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-text">Manual search</p>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, email or registration number"
          className="mt-2"
        />
        {results.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {r.full_name} <span className="text-text-muted">({r.registration_number}, {r.category_name})</span>
                </span>
                <Button type="button" size="sm" disabled={busy} onClick={() => checkIn(r.id)}>
                  Check in
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export default CheckInPanel
