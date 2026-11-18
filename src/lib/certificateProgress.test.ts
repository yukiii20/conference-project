import { describe, expect, it } from 'vitest'
import { certificateSteps, type CertificateProgress } from './certificateProgress'

const base: CertificateProgress = {
  registered: true,
  checked_in: true,
  sessions_attended: 2,
  sessions_by_method: { qr: 1, online: 1, manual: 0 },
  min_sessions: 3,
  release_at: null,
  released: false,
  eligible: false,
  certificate: null,
  message: '',
}

describe('certificateSteps', () => {
  it('shows "2 of 3" with the online count, and the release step', () => {
    const steps = certificateSteps(base)
    expect(steps.map((s) => s.label)).toEqual(['Registration confirmed', 'Checked in at the desk', 'Sessions attended: 2 of 3', 'Release date not set yet'])
    expect(steps[2]).toMatchObject({ done: false, detail: '1 online' })
  })

  it('caps the count at the minimum and drops the sessions step when there is no minimum', () => {
    expect(certificateSteps({ ...base, sessions_attended: 5 })[2]).toMatchObject({ label: 'Sessions attended: 3 of 3', done: true })
    expect(certificateSteps({ ...base, min_sessions: null }).map((s) => s.label)).not.toContain('Sessions attended: 2 of 3')
    expect(certificateSteps({ ...base, released: true }).at(-1)).toEqual({ label: 'Certificates released', done: true })
  })
})
