import { formatKathmandu } from './datetime'

export type CertificateProgress = {
  registered: boolean
  checked_in: boolean
  sessions_attended: number
  sessions_by_method: { qr: number; online: number; manual: number }
  min_sessions: number | null
  release_at: string | null
  released: boolean
  eligible: boolean
  certificate: { id: string; certificate_number: string; status: string } | null
  message: string
}

export type CertificateStep = { label: string; done: boolean; detail?: string }

/** The checklist shown on the card, in order. */
export function certificateSteps(p: CertificateProgress): CertificateStep[] {
  const steps: CertificateStep[] = [
    { label: 'Registration confirmed', done: p.registered },
    { label: 'Checked in at the desk', done: p.checked_in },
  ]
  if (p.min_sessions != null) {
    const online = p.sessions_by_method.online
    steps.push({
      label: `Sessions attended: ${Math.min(p.sessions_attended, p.min_sessions)} of ${p.min_sessions}`,
      done: p.sessions_attended >= p.min_sessions,
      detail: online > 0 ? `${online} online` : undefined,
    })
  }
  steps.push({
    label: p.released ? 'Certificates released' : p.release_at ? `Released on ${formatKathmandu(p.release_at, { dateOnly: true })}` : 'Release date not set yet',
    done: p.released,
  })
  return steps
}
