import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../src/db/pool.js'
import { applyBrevoEvents } from '../src/modules/emailWebhooks/service.js'
import { resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function insertEmail(status: string, messageId: string | null): Promise<number> {
  const [result] = await pool.query(
    `INSERT INTO email_logs (recipient_email, template_key, subject, template_data, status, provider_message_id)
     VALUES ('someone@example.com', 'account_created', 'Welcome', '{}', ?, ?)`,
    [status, messageId],
  )
  return (result as { insertId: number }).insertId
}

async function statusOf(id: number): Promise<{ status: string; error_message: string | null }> {
  const [rows] = await pool.query('SELECT status, error_message FROM email_logs WHERE id = ?', [id])
  return (rows as Array<{ status: string; error_message: string | null }>)[0]!
}

describe('applyBrevoEvents (database)', () => {
  it('sent -> delivered, matching the id with or without angle brackets', async () => {
    const a = await insertEmail('sent', '<m1@relay>')
    const b = await insertEmail('sent', 'm2@relay')
    expect(await applyBrevoEvents([{ event: 'delivered', 'message-id': 'm1@relay' }, { event: 'delivered', 'message-id': '<m2@relay>' }])).toBe(2)
    expect((await statusOf(a)).status).toBe('delivered')
    expect((await statusOf(b)).status).toBe('delivered')
  })

  it('a bounce is final: a late "delivered" never overwrites it', async () => {
    const id = await insertEmail('sent', '<m3@relay>')
    await applyBrevoEvents([{ event: 'hard_bounce', 'message-id': '<m3@relay>', reason: 'no such user' }])
    expect(await statusOf(id)).toEqual({ status: 'bounced', error_message: 'Brevo: no such user' })
    expect(await applyBrevoEvents([{ event: 'delivered', 'message-id': '<m3@relay>' }])).toBe(0)
    expect((await statusOf(id)).status).toBe('bounced')
  })

  it('never touches rows that are not sent yet, and ignores unknown ids', async () => {
    const queued = await insertEmail('queued', '<m4@relay>')
    expect(await applyBrevoEvents([{ event: 'delivered', 'message-id': '<m4@relay>' }, { event: 'delivered', 'message-id': 'nope' }])).toBe(0)
    expect((await statusOf(queued)).status).toBe('queued')
  })
})
