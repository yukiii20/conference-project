import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { api, ApiError } from '../../lib/api'

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

/** Shared by the convenor/manager Attendance tab and the staff check-in page — same backend, same UI either way. */
export function CheckInPanel({ conferenceId }: { conferenceId: string }) {
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

  async function checkIn(registrationId: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.post<{ full_name: string; registration_number: string }>(`/conferences/${conferenceId}/checkin/manual`, {
        registration_id: registrationId,
      })
      setMessage({ kind: 'ok', text: `Checked in: ${res.full_name} (${res.registration_number})` })
      setQuery('')
      setResults([])
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
      const res = await api.post<{ full_name: string; registration_number: string }>(`/conferences/${conferenceId}/checkin`, {
        qr_token: token,
      })
      setMessage({ kind: 'ok', text: `Checked in: ${res.full_name} (${res.registration_number})` })
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
          className={`rounded-md px-4 py-3 text-center text-lg font-semibold ${
            message.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-line bg-white p-4">
        <p className="text-sm font-medium text-ink">Scan a QR code</p>
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
              <button type="button" onClick={stopCamera} className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background">
                Stop camera
              </button>
            ) : (
              <button
                type="button"
                onClick={startCamera}
                className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Start camera
              </button>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink/60">Camera scanning is not supported in this browser — use manual search below.</p>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-white p-4">
        <p className="text-sm font-medium text-ink">Manual search</p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, email or registration number"
          className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        />
        {results.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <span>
                  {r.full_name} <span className="text-ink/50">({r.registration_number}, {r.category_name})</span>
                </span>
                <button
                  type="button"
                  onClick={() => checkIn(r.id)}
                  disabled={busy}
                  className="rounded-md bg-button px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Check in
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export default CheckInPanel
