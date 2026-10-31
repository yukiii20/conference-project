import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Maximize, MessageCircleQuestion, Pause, Play, RotateCcw, SkipForward, Check } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { formatKathmanduTime } from '../lib/datetime'
import { useToast } from '../components/ui/Toast'
import { Button, EmptyState, Skeleton, buttonClasses } from '../components/ui'
import {
  colourFor,
  formatClock,
  initialTimerState,
  nextTalk,
  parseSavedState,
  remainingMs,
  resetPhase,
  startQa,
  toggle,
  type TimerColour,
  type TimerConfig,
  type TimerState,
} from '../lib/sessionTimer'

type TimerTalk = { id: string; title: string; speaker: string; status: string; presentation_order: number }

type TimerData = {
  conference: { id: string; name: string }
  session: { id: string; title: string; starts_at: string; ends_at: string; room_name: string | null }
  timing: { talk_minutes: number; qa_minutes: number }
  talks: TimerTalk[]
}

// Deliberately not theme tokens: maximum contrast on a dark projector
// screen, readable from the back of a hall, in both light and dark rooms.
const COLOURS: Record<TimerColour, { fg: string; label: string }> = {
  green: { fg: '#4ade80', label: 'On time' },
  amber: { fg: '#fbbf24', label: 'Last 2 minutes' },
  red: { fg: '#f87171', label: 'Time up' },
}

const PENDING_MARKS_KEY = 'session-timer-pending-marks'

type PendingMark = { conferenceId: string; sessionId: string; presentationId: string }

function readPendingMarks(): PendingMark[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_MARKS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writePendingMarks(marks: PendingMark[]): void {
  try {
    localStorage.setItem(PENDING_MARKS_KEY, JSON.stringify(marks))
  } catch {
    // Storage blocked (private mode): the mark is simply retried on the next tap.
  }
}

/**
 * Keeps the screen on while the timer is open: the Wake Lock API where the
 * browser has it (re-acquired whenever the tab becomes visible again, since
 * the browser drops it on tab switch), otherwise a tiny muted looping video
 * from a canvas stream - playing video is what stops most phones and
 * laptops dimming the screen.
 */
function useScreenAwake(): 'wake-lock' | 'video' | 'unsupported' {
  const [mode, setMode] = useState<'wake-lock' | 'video' | 'unsupported'>('unsupported')

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let video: HTMLVideoElement | null = null
    let cancelled = false
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }

    async function acquire() {
      if (nav.wakeLock) {
        try {
          lock = await nav.wakeLock.request('screen')
          if (!cancelled) setMode('wake-lock')
          return
        } catch {
          // Denied (e.g. low battery) - fall through to the video fallback.
        }
      }
      if (video) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 2
        canvas.height = 2
        const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(1)
        if (!stream) return
        video = document.createElement('video')
        video.muted = true
        video.loop = true
        video.setAttribute('playsinline', '')
        video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'
        video.srcObject = stream
        document.body.appendChild(video)
        await video.play()
        if (!cancelled) setMode('video')
      } catch {
        // Nothing else we can do; the page tells the chair to keep the screen on.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      lock?.release().catch(() => {})
      if (video) {
        video.pause()
        video.remove()
      }
    }
  }, [])

  return mode
}

/** Full-screen talk timer for a session chair (or the convenor): big numbers, green/amber/red, keyboard shortcuts, works offline once loaded. */
export function SessionTimerPage() {
  const { conferenceId = '', sessionId = '' } = useParams<{ conferenceId: string; sessionId: string }>()
  const { showToast } = useToast()
  const [data, setData] = useState<TimerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<TimerState>(initialTimerState)
  const [now, setNow] = useState(() => Date.now())
  const [presented, setPresented] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const awake = useScreenAwake()
  const storageKey = `session-timer:${sessionId}`
  const restoredRef = useRef(false)

  useEffect(() => {
    api
      .get<TimerData>(`/conferences/${conferenceId}/sessions/${sessionId}/timer`)
      .then((d) => {
        setData(d)
        setPresented(new Set(d.talks.filter((t) => t.status === 'presented').map((t) => t.id)))
        document.title = `Timer · ${d.session.title}`
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this session.'))
  }, [conferenceId, sessionId])

  const config: TimerConfig | null = data
    ? { talkMinutes: data.timing.talk_minutes, qaMinutes: data.timing.qa_minutes, talkCount: data.talks.length }
    : null

  // Restore an in-progress timer after an accidental reload, once the talk count is known.
  useEffect(() => {
    if (!config || restoredRef.current) return
    restoredRef.current = true
    let saved: string | null = null
    try {
      saved = localStorage.getItem(storageKey)
    } catch {
      saved = null
    }
    const restored = parseSavedState(saved, config)
    if (restored) setState(restored)
  }, [config, storageKey])

  useEffect(() => {
    if (!restoredRef.current) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Storage blocked: the timer still works, it just won't survive a reload.
    }
  }, [state, storageKey])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  const flushPendingMarks = useCallback(async () => {
    const pending = readPendingMarks()
    if (pending.length === 0) return
    const stillPending: PendingMark[] = []
    for (const m of pending) {
      try {
        await api.patch(`/conferences/${m.conferenceId}/sessions/${m.sessionId}/presentations/${m.presentationId}/mark`, {
          status: 'presented',
        })
      } catch (err) {
        // Only keep it for a retry when the network was the problem; a real refusal (403/404) won't fix itself.
        if (!(err instanceof ApiError)) stillPending.push(m)
      }
    }
    writePendingMarks(stillPending)
    if (stillPending.length < pending.length) showToast('Saved "presented" marks made while offline.', 'success')
  }, [showToast])

  useEffect(() => {
    flushPendingMarks()
    window.addEventListener('online', flushPendingMarks)
    return () => window.removeEventListener('online', flushPendingMarks)
  }, [flushPendingMarks])

  const act = useCallback(
    (fn: (s: TimerState, c: TimerConfig, t: number) => TimerState) => {
      if (!config) return
      setState((s) => fn(s, config, Date.now()))
    },
    [config],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        act((s, _c, t) => toggle(s, t))
      } else if (e.key === 'n' || e.key === 'N') {
        act(nextTalk)
      } else if (e.key === 'q' || e.key === 'Q') {
        act(startQa)
      } else if (e.key === 'f' || e.key === 'F') {
        document.documentElement.requestFullscreen?.().catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act])

  async function markPresented(talk: TimerTalk) {
    setMarking(true)
    try {
      await api.patch(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/${talk.id}/mark`, { status: 'presented' })
      setPresented((p) => new Set(p).add(talk.id))
      showToast(`Marked "${talk.title}" presented.`, 'success')
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        // Offline: remember it and send it as soon as the connection is back.
        writePendingMarks([...readPendingMarks(), { conferenceId, sessionId, presentationId: talk.id }])
        setPresented((p) => new Set(p).add(talk.id))
        showToast('You are offline - this will be saved when the connection comes back.', 'info')
      }
    }
    setMarking(false)
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-border bg-surface p-6 text-center">
          <p className="font-medium text-text">{error}</p>
          <Link to="/portal/session-chair" className={`${buttonClasses('primary', 'sm')} mt-4`}>
            Back to my sessions
          </Link>
        </div>
      </div>
    )
  }

  if (!data || !config) {
    return (
      <div className="min-h-screen bg-black p-6" aria-busy="true">
        <Skeleton className="h-6 w-64 opacity-30" />
        <Skeleton className="mx-auto mt-24 h-48 w-full max-w-2xl opacity-30" />
      </div>
    )
  }

  if (data.talks.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            title="No talks in this session yet."
            message="Add presentations to this session in the convenor's Programme tab, then open the timer again."
          />
          <p className="pb-6 text-center">
            <Link to="/portal/session-chair" className={buttonClasses('secondary', 'sm')}>
              Back to my sessions
            </Link>
          </p>
        </div>
      </div>
    )
  }

  const talk = data.talks[state.talkIndex]!
  const upNext = data.talks[state.talkIndex + 1] ?? null
  const remaining = remainingMs(state, config, now)
  const colour = colourFor(remaining)
  const isLast = state.talkIndex >= data.talks.length - 1

  return (
    <div className="flex min-h-screen flex-col bg-black text-white" data-testid="session-timer" data-colour={colour}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-white/70 sm:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">{data.session.title}</h1>
          <p className="truncate">
            Session timer · {formatKathmanduTime(data.session.starts_at)} – {formatKathmanduTime(data.session.ends_at)}
            {data.session.room_name ? ` · ${data.session.room_name}` : ''} · {data.timing.talk_minutes} min talk +{' '}
            {data.timing.qa_minutes} min Q&amp;A
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-white/30 px-3 hover:bg-white/10"
          >
            <Maximize aria-hidden className="h-4 w-4" /> Full screen
          </button>
          <Link to="/portal/session-chair" className="inline-flex min-h-10 items-center rounded-md border border-white/30 px-3 hover:bg-white/10">
            Exit
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-lg text-white/70 sm:text-2xl">
          Talk {state.talkIndex + 1} of {data.talks.length} · {state.phase === 'talk' ? 'Talk' : 'Q&A'}
        </p>
        <p className="mt-2 max-w-4xl text-2xl font-semibold sm:text-4xl">{talk.title}</p>
        {talk.speaker ? <p className="mt-1 text-lg text-white/80 sm:text-2xl">{talk.speaker}</p> : null}

        <p
          role="timer"
          aria-live="off"
          aria-label={`${formatClock(remaining)} ${remaining < 0 ? 'overtime' : 'remaining'}`}
          className="mt-6 font-mono font-bold leading-none tabular-nums"
          style={{ color: COLOURS[colour].fg, fontSize: 'clamp(5rem, 24vw, 22rem)' }}
        >
          {formatClock(remaining)}
        </p>
        <p className="mt-3 text-xl font-semibold uppercase tracking-widest sm:text-3xl" style={{ color: COLOURS[colour].fg }}>
          {remaining < 0 ? 'Overtime' : COLOURS[colour].label}
          {!state.running ? ' · Paused' : ''}
        </p>

        <p className="mt-6 text-base text-white/70 sm:text-xl">
          {upNext ? (
            <>
              Next: <span className="text-white">{upNext.speaker || upNext.title}</span>
              {upNext.speaker ? ` - ${upNext.title}` : ''}
            </>
          ) : (
            'This is the last talk of the session.'
          )}
        </p>
      </main>

      <footer className="px-4 pb-6 sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => act((s, _c, t) => toggle(s, t))}
            className="inline-flex min-h-14 min-w-36 items-center justify-center gap-2 rounded-lg bg-white px-6 text-lg font-semibold text-black hover:bg-white/90"
          >
            {state.running ? <Pause aria-hidden className="h-6 w-6" /> : <Play aria-hidden className="h-6 w-6" />}
            {state.running ? 'Pause' : 'Start'}
          </button>
          {state.phase === 'talk' && data.timing.qa_minutes > 0 ? (
            <button
              type="button"
              onClick={() => act(startQa)}
              className="inline-flex min-h-14 items-center gap-2 rounded-lg border-2 border-white px-5 text-lg font-semibold hover:bg-white/10"
            >
              <MessageCircleQuestion aria-hidden className="h-6 w-6" /> Start Q&amp;A
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => act(nextTalk)}
            disabled={isLast}
            className="inline-flex min-h-14 items-center gap-2 rounded-lg border-2 border-white px-5 text-lg font-semibold hover:bg-white/10 disabled:opacity-40"
          >
            <SkipForward aria-hidden className="h-6 w-6" /> Next talk
          </button>
          <button
            type="button"
            onClick={() => act((s) => resetPhase(s))}
            className="inline-flex min-h-14 items-center gap-2 rounded-lg border border-white/40 px-4 text-white/80 hover:bg-white/10"
          >
            <RotateCcw aria-hidden className="h-5 w-5" /> Reset
          </button>
          {presented.has(talk.id) ? (
            <span className="inline-flex min-h-14 items-center gap-2 px-4 text-lg text-[#4ade80]">
              <Check aria-hidden className="h-6 w-6" /> Presented
            </span>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-14"
              loading={marking}
              onClick={() => markPresented(talk)}
            >
              Mark presented
            </Button>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-white/50">
          Shortcuts: Space start/pause · N next talk · Q start Q&amp;A · F full screen.{' '}
          {awake === 'unsupported' ? 'This browser cannot keep the screen on - turn off screen sleep in your settings.' : 'Screen kept awake.'}{' '}
          Works offline once opened.
        </p>
      </footer>
    </div>
  )
}
