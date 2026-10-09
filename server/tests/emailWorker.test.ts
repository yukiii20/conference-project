import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '../src/db/pool.js'
import { setMailProviderForTesting, type MailProvider } from '../src/email/provider.js'
import { recoverStuckSendingRows, runEmailWorkerOnce } from '../src/email/worker.js'
import { resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
})

afterEach(() => {
  setMailProviderForTesting(null)
})

afterAll(async () => {
  await pool.end()
})

async function insertEmailLog(overrides: {
  templateKey?: string
  recipientEmail?: string
  subject?: string
  templateData?: Record<string, unknown>
  status?: string
  attempts?: number
}): Promise<number> {
  const [result] = await pool.query(
    `INSERT INTO email_logs (recipient_email, template_key, subject, template_data, status, attempts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      overrides.recipientEmail ?? 'someone@example.com',
      overrides.templateKey ?? 'account_created',
      overrides.subject ?? 'Welcome',
      JSON.stringify(overrides.templateData ?? { full_name: 'Ann' }),
      overrides.status ?? 'queued',
      overrides.attempts ?? 0,
    ],
  )
  return (result as { insertId: number }).insertId
}

async function loadRow(id: number) {
  const [rows] = await pool.query(
    `SELECT status, attempts, error_message, sent_at, provider_message_id, template_data FROM email_logs WHERE id = ?`,
    [id],
  )
  return (rows as Array<Record<string, unknown>>)[0]!
}

async function pushUpdatedAtIntoThePast(id: number, minutesAgo: number): Promise<void> {
  await pool.query(`UPDATE email_logs SET updated_at = DATE_SUB(NOW(3), INTERVAL ? MINUTE) WHERE id = ?`, [minutesAgo, id])
}

describe('email worker', () => {
  it('console mode (the real default provider in tests) marks a queued row sent', async () => {
    const id = await insertEmailLog({})
    await runEmailWorkerOnce()
    const row = await loadRow(id)
    expect(row.status).toBe('sent')
    expect(row.sent_at).not.toBeNull()
  })

  it('sends via a mocked transport and stores the provider message id', async () => {
    const sendMail = vi.fn(async () => ({ providerMessageId: 'mock-123' }))
    setMailProviderForTesting({ sendMail } as MailProvider)

    const id = await insertEmailLog({})
    await runEmailWorkerOnce()

    expect(sendMail).toHaveBeenCalledTimes(1)
    const row = await loadRow(id)
    expect(row.status).toBe('sent')
    expect(row.provider_message_id).toBe('mock-123')
  })

  it('HTML-escapes a placeholder value (e.g. a user\'s name) before sending', async () => {
    const sendMail = vi.fn(async () => ({}))
    setMailProviderForTesting({ sendMail } as MailProvider)

    await insertEmailLog({ templateData: { full_name: '<b>Evil</b>' } })
    await runEmailWorkerOnce()

    const sentHtml = sendMail.mock.calls[0]![0].html as string
    expect(sentHtml).not.toContain('<b>Evil</b>')
    expect(sentHtml).toContain('&lt;b&gt;Evil&lt;/b&gt;')
  })

  it('redacts secret-shaped placeholders (e.g. reset_url) once the email has sent', async () => {
    const sendMail = vi.fn(async () => ({}))
    setMailProviderForTesting({ sendMail } as MailProvider)

    const id = await insertEmailLog({
      templateKey: 'password_reset',
      templateData: { full_name: 'Ann', reset_url: 'http://localhost:5173/reset-password?token=supersecret' },
    })
    await runEmailWorkerOnce()

    // The actual email sent still carried the real link.
    const sentHtml = sendMail.mock.calls[0]![0].html as string
    expect(sentHtml).toContain('supersecret')

    // But the stored record no longer does.
    const row = await loadRow(id)
    expect(row.template_data).toEqual({ full_name: 'Ann', reset_url: '[redacted]' })
  })

  it('retries a failing send with backoff and gives up (and redacts) after 5 attempts', async () => {
    const sendMail = vi.fn(async () => {
      throw new Error('SMTP server refused the connection')
    })
    setMailProviderForTesting({ sendMail } as MailProvider)

    const id = await insertEmailLog({
      templateKey: 'password_reset',
      templateData: { reset_url: 'http://localhost:5173/reset-password?token=abc' },
    })

    for (let expectedAttempts = 1; expectedAttempts <= 5; expectedAttempts++) {
      await runEmailWorkerOnce()
      const row = await loadRow(id)
      expect(row.status).toBe('failed')
      expect(row.attempts).toBe(expectedAttempts)
      expect(String(row.error_message)).toContain('SMTP server refused the connection')
      // Make the row eligible for the next attempt immediately instead of waiting for the real backoff window.
      await pushUpdatedAtIntoThePast(id, 10_000)
    }

    expect(sendMail).toHaveBeenCalledTimes(5)
    const finalRow = await loadRow(id)
    expect(finalRow.attempts).toBe(5)
    expect(finalRow.template_data).toEqual({ reset_url: '[redacted]' })

    // A 6th tick must not pick it up again — attempts < 5 no longer holds.
    await runEmailWorkerOnce()
    expect(sendMail).toHaveBeenCalledTimes(5)
  })

  it('does not retry a failed row before its backoff window has elapsed', async () => {
    const sendMail = vi.fn(async () => {
      throw new Error('temporary failure')
    })
    setMailProviderForTesting({ sendMail } as MailProvider)

    const id = await insertEmailLog({})
    await runEmailWorkerOnce() // attempts: 0 -> 1, updated_at = now
    expect(sendMail).toHaveBeenCalledTimes(1)

    await runEmailWorkerOnce() // immediately again — backoff (2^1 = 2 min) hasn't elapsed
    expect(sendMail).toHaveBeenCalledTimes(1)

    const row = await loadRow(id)
    expect(row.attempts).toBe(1)
  })

  it('recovers rows stuck in sending for too long back to queued', async () => {
    const id = await insertEmailLog({ status: 'sending' })
    await pool.query(`UPDATE email_logs SET updated_at = DATE_SUB(NOW(3), INTERVAL 20 MINUTE) WHERE id = ?`, [id])

    await recoverStuckSendingRows()

    const row = await loadRow(id)
    expect(row.status).toBe('queued')
  })

  it('leaves a recently-started sending row alone', async () => {
    const id = await insertEmailLog({ status: 'sending' })
    await recoverStuckSendingRows()
    const row = await loadRow(id)
    expect(row.status).toBe('sending')
  })
})
