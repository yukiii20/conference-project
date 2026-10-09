import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/withTransaction.js'
import { notifyUser } from '../src/utils/notifications.js'
import { createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function notify(userId: string, title: string, read = false) {
  await withTransaction(null, async (conn) => {
    await notifyUser(conn, { userId, type: 'system', title, body: 'Body text' })
  })
  if (read) {
    await pool.query(`UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND title = ?`, [userId, title])
  }
}

describe('notifications', () => {
  it('lists only the caller\'s own notifications, newest first', async () => {
    const userId = await createUser({ email: 'owner@example.com', password: 'Str0ng!Pass' })
    const otherId = await createUser({ email: 'other@example.com', password: 'Str0ng!Pass' })
    await notify(userId, 'First')
    await notify(userId, 'Second')
    await notify(otherId, 'Not yours')

    const cookie = await createDirectSession(userId)
    const res = await request(app).get('/api/me/notifications').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual(['Second', 'First'])
  })

  it('filters to unread only when asked', async () => {
    const userId = await createUser({ email: 'unread@example.com', password: 'Str0ng!Pass' })
    await notify(userId, 'Already read', true)
    await notify(userId, 'Still unread', false)

    const cookie = await createDirectSession(userId)
    const res = await request(app).get('/api/me/notifications').set('Cookie', cookie).query({ unread: '1' })
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.notifications[0].title).toBe('Still unread')
  })

  it('marks one notification read, and refuses to touch someone else\'s', async () => {
    const userId = await createUser({ email: 'reader@example.com', password: 'Str0ng!Pass' })
    const otherId = await createUser({ email: 'intruder@example.com', password: 'Str0ng!Pass' })
    await notify(userId, 'Mine')

    const [rows] = await pool.query('SELECT id FROM notifications WHERE user_id = ? LIMIT 1', [userId])
    const notificationId = (rows as Array<{ id: string }>)[0]!.id

    const otherCookie = await createDirectSession(otherId)
    const intrudeRes = await request(app)
      .post(`/api/me/notifications/${notificationId}/read`)
      .set('Cookie', otherCookie)
    expect(intrudeRes.status).toBe(404)

    const ownerCookie = await createDirectSession(userId)
    const ownRes = await request(app).post(`/api/me/notifications/${notificationId}/read`).set('Cookie', ownerCookie)
    expect(ownRes.status).toBe(200)

    const [afterRows] = await pool.query('SELECT read_at FROM notifications WHERE id = ?', [notificationId])
    expect((afterRows as Array<{ read_at: string | null }>)[0]!.read_at).not.toBeNull()
  })

  it('marks every notification read with read-all', async () => {
    const userId = await createUser({ email: 'markall@example.com', password: 'Str0ng!Pass' })
    await notify(userId, 'One')
    await notify(userId, 'Two')

    const cookie = await createDirectSession(userId)
    const res = await request(app).post('/api/me/notifications/read-all').set('Cookie', cookie)
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT read_at FROM notifications WHERE user_id = ?', [userId])
    for (const row of rows as Array<{ read_at: string | null }>) {
      expect(row.read_at).not.toBeNull()
    }
  })

  it('is unauthorized when logged out', async () => {
    const res = await request(app).get('/api/me/notifications')
    expect(res.status).toBe(401)
  })
})
