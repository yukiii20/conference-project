import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Download, Mail, Printer, WifiOff } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { formatDateRange, formatKathmandu } from '../lib/datetime'
import { toneBannerClasses, toneBadgeClasses } from '../lib/status'

/**
 * /c/:slug/ticket - the Audience member's QR ticket, built to open fast on a phone at the
 * registration desk: one small request, no portal chrome, and the last good copy is kept on the
 * device (localStorage) so the QR still shows with no signal. Printable (Print button / Ctrl+P
 * prints just the ticket) and downloadable as a PNG.
 */
type Ticket = {
  registration: {
    id: string
    registration_number: string
    status: 'pending' | 'confirmed' | 'waitlisted'
    category_name: string
    registered_at: string
    checked_in: boolean
  }
  holder: { full_name: string; email: string }
  conference: {
    id: string
    name: string
    short_name: string | null
    slug: string
    start_date: string
    end_date: string
    timezone: string
    venue_name: string | null
    address: string | null
    city: string | null
  }
  qr_data_url: string
}

type Saved = { ticket: Ticket; saved_at: string }

const STATUS_TEXT: Record<Ticket['registration']['status'], { label: string; tone: string; note: string }> = {
  confirmed: { label: 'Confirmed', tone: toneBadgeClasses('success'), note: 'Show this QR code at the registration desk.' },
  pending: {
    label: 'Waiting for payment',
    tone: toneBadgeClasses('warning'),
    note: 'Your place is held. The organisers confirm the ticket once your payment is received; you can already show this code at the desk.',
  },
  waitlisted: {
    label: 'On the waiting list',
    tone: toneBadgeClasses('neutral'),
    note: 'You are on the waiting list. We will email you if a place opens up.',
  },
}

const storageKey = (slug: string) => `cms:ticket:${slug}`

function readSaved(slug: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(storageKey(slug))
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

function writeSaved(slug: string, ticket: Ticket): void {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify({ ticket, saved_at: new Date().toISOString() } satisfies Saved))
  } catch {
    // Private mode / full storage: the page still works online.
  }
}

function clearSaved(slug: string): void {
  try {
    window.localStorage.removeItem(storageKey(slug))
  } catch {
    // ignore
  }
}

/** Draws the ticket (QR + name + number) onto a canvas and downloads it as one PNG. */
async function downloadTicketPng(ticket: Ticket): Promise<void> {
  const img = new Image()
  img.src = ticket.qr_data_url
  await img.decode()
  const width = 600
  const height = 820
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#101c32'
  ctx.textAlign = 'center'
  ctx.font = '600 26px system-ui, sans-serif'
  ctx.fillText(ticket.conference.short_name || ticket.conference.name, width / 2, 60, width - 60)
  ctx.font = '18px system-ui, sans-serif'
  ctx.fillText(formatDateRange(ticket.conference.start_date, ticket.conference.end_date), width / 2, 92)
  ctx.drawImage(img, 120, 120, 360, 360)
  ctx.font = '600 30px system-ui, sans-serif'
  ctx.fillText(ticket.holder.full_name, width / 2, 540, width - 60)
  ctx.font = '600 28px ui-monospace, monospace'
  ctx.fillText(ticket.registration.registration_number, width / 2, 590)
  ctx.font = '18px system-ui, sans-serif'
  ctx.fillText(ticket.registration.category_name, width / 2, 625, width - 60)
  if (ticket.conference.venue_name) ctx.fillText(ticket.conference.venue_name, width / 2, 660, width - 60)
  ctx.fillStyle = '#5b6474'
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillText('Show this code at the registration desk.', width / 2, 760)
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `ticket-${ticket.registration.registration_number}.png`
  link.click()
}

export function TicketPage() {
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const welcome = searchParams.get('welcome') === '1'
  const [ticket, setTicket] = useState<Ticket | null>(() => readSaved(slug)?.ticket ?? null)
  const [savedAt, setSavedAt] = useState<string | null>(() => readSaved(slug)?.saved_at ?? null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'signed_out' | 'wrong_conference' | 'none' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [emailState, setEmailState] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false })

  const load = useCallback(async () => {
    setState('loading')
    try {
      const data = await api.get<Ticket>(`/conferences/${encodeURIComponent(slug)}/my-ticket`)
      setTicket(data)
      setSavedAt(null)
      writeSaved(slug, data)
      setState('ready')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          clearSaved(slug)
          setTicket(null)
          setState('signed_out')
        } else if (err.code === 'wrong_conference') {
          setState('wrong_conference')
        } else if (err.status === 404) {
          clearSaved(slug)
          setTicket(null)
          setState('none')
        } else {
          setMessage(err.message)
          setState(readSaved(slug) ? 'offline' : 'error')
        }
      } else {
        // Network failure: keep showing the saved copy.
        setState(readSaved(slug) ? 'offline' : 'error')
        setMessage("Can't reach the server. Check your connection.")
      }
    }
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  async function emailTicket() {
    setEmailState({ busy: true, text: null, error: false })
    try {
      const data = await api.post<{ message: string }>(`/conferences/${ticket!.conference.id}/my-ticket/email`, {})
      setEmailState({ busy: false, text: data.message, error: false })
    } catch (err) {
      setEmailState({ busy: false, text: err instanceof ApiError ? err.message : "Can't reach the server.", error: true })
    }
  }

  const conferenceHref = `/c/${encodeURIComponent(slug)}`

  if (!ticket) {
    return (
      <TicketFrame>
        {state === 'loading' ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading your ticket">
            <div className="mx-auto h-64 w-64 animate-pulse rounded-2xl bg-surface-muted" />
            <div className="mx-auto h-5 w-40 animate-pulse rounded bg-surface-muted" />
          </div>
        ) : state === 'signed_out' ? (
          <Notice title="Sign in to see your ticket">
            <Link to={`${conferenceHref}/login`} className="font-medium text-button underline">
              Sign in
            </Link>{' '}
            or{' '}
            <Link to={`${conferenceHref}/signup`} className="font-medium text-button underline">
              sign up as Audience
            </Link>
            .
          </Notice>
        ) : state === 'wrong_conference' ? (
          <Notice title="You are signed in to a different conference">
            <Link to={`${conferenceHref}/login`} className="font-medium text-button underline">
              Sign in at this conference
            </Link>{' '}
            to see its ticket.
          </Notice>
        ) : state === 'none' ? (
          <Notice title="No ticket yet">
            You are not registered for this conference.{' '}
            <Link to={`${conferenceHref}#registration`} className="font-medium text-button underline">
              Register now
            </Link>
            .
          </Notice>
        ) : (
          <Notice title="Could not load your ticket">
            {message ?? 'Something went wrong.'}{' '}
            <button type="button" onClick={load} className="font-medium text-button underline">
              Try again
            </button>
          </Notice>
        )}
      </TicketFrame>
    )
  }

  const status = STATUS_TEXT[ticket.registration.status]
  const venue = [ticket.conference.venue_name, ticket.conference.city].filter(Boolean).join(', ')

  return (
    <TicketFrame>
      {welcome ? (
        <div className={`no-print mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${toneBannerClasses('success')}`} role="status">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>You're registered. We've also emailed you a link to this ticket.</span>
        </div>
      ) : null}
      {state === 'offline' ? (
        <div className={`no-print mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${toneBannerClasses('warning')}`} role="status">
          <WifiOff size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Offline - showing the copy saved on this device{savedAt ? ` (${formatKathmandu(savedAt)})` : ''}.{' '}
            <button type="button" onClick={load} className="font-medium underline">
              Retry
            </button>
          </span>
        </div>
      ) : null}

      <article className="ticket-card rounded-2xl border border-border bg-surface p-5 text-center shadow-sm" aria-label="Your ticket">
        <p className="text-sm font-medium text-text-muted">{ticket.conference.short_name || ticket.conference.name}</p>
        <p className="text-xs text-text-muted">
          {formatDateRange(ticket.conference.start_date, ticket.conference.end_date)}
          {venue ? ` · ${venue}` : ''}
        </p>
        <img
          src={ticket.qr_data_url}
          alt={`Check-in QR code for ticket ${ticket.registration.registration_number}`}
          width={288}
          height={288}
          className="mx-auto mt-4 h-72 w-72 max-w-full rounded-xl border border-border-soft bg-white"
        />
        <p className="mt-4 font-display text-xl font-semibold text-text">{ticket.holder.full_name}</p>
        <p className="mt-1 font-mono text-lg tracking-wide text-text">{ticket.registration.registration_number}</p>
        <p className="mt-1 text-sm text-text-muted">{ticket.registration.category_name}</p>
        <p className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium ${status.tone}`}>
          {ticket.registration.checked_in ? 'Checked in' : status.label}
        </p>
        <p className="mt-2 text-sm text-text-muted">{ticket.registration.checked_in ? 'Welcome! You have been checked in.' : status.note}</p>
      </article>

      <div className="no-print mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => downloadTicketPng(ticket)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-page-bg"
        >
          <Download size={16} aria-hidden="true" /> Download
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-page-bg"
        >
          <Printer size={16} aria-hidden="true" /> Print
        </button>
        <button
          type="button"
          onClick={emailTicket}
          disabled={emailState.busy || state === 'offline'}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-page-bg disabled:opacity-50"
        >
          <Mail size={16} aria-hidden="true" /> {emailState.busy ? 'Sending…' : 'Email it to me'}
        </button>
      </div>
      {emailState.text ? (
        <p className={`no-print mt-2 text-center text-sm ${emailState.error ? 'text-danger' : 'text-success'}`} role="status">
          {emailState.text}
        </p>
      ) : null}

      <p className="no-print mt-6 text-center text-xs text-text-muted">
        Tip: this page keeps working without signal once it has opened here. Add it to your home screen for quick access.
      </p>
      <nav className="no-print mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
        <Link to="/portal/dashboard" className="font-medium text-button underline-offset-4 hover:underline">
          My portal
        </Link>
        <Link to={conferenceHref} className="font-medium text-button underline-offset-4 hover:underline">
          Conference page
        </Link>
      </nav>
    </TicketFrame>
  )
}

function TicketFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page-bg px-4 py-6">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } .ticket-card { border: 1px solid #ccc; box-shadow: none; } }`}</style>
      <main className="mx-auto w-full max-w-sm">{children}</main>
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center">
      <h1 className="font-display text-lg font-semibold text-text">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">{children}</p>
    </div>
  )
}
