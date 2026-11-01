import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { createDirectSession, createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
  // The role row comes from database/07_super_admin.sql; make sure the test DB has it.
  await pool.query(
    `INSERT IGNORE INTO roles (code, name, scope, description) VALUES ('super_admin', 'Super Administrator', 'platform', 'test')`,
  )
})

afterAll(async () => {
  await pool.end()
})

async function admin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const cookie = await createDirectSession(userId)
  const as = {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
  return { userId, as }
}

describe('super administrator', () => {
  it('before anyone is a super admin, every admin keeps full rights (old behaviour)', async () => {
    const a = await admin('sa-a@example.com')
    await createUser({ email: 'sa-new@example.com', password: 'Str0ng!Pass' })
    expect((await a.as.get('/api/auth/me')).body.isSuperAdmin).toBe(true)
    expect((await a.as.post('/api/admin/admins').send({ email: 'sa-new@example.com' })).status).toBe(200)
  })

  it('the first grant also makes the granting admin a super admin', async () => {
    const a = await admin('sa-a2@example.com')
    const b = await admin('sa-b2@example.com')
    expect((await a.as.post(`/api/admin/admins/${b.userId}/super`)).status).toBe(200)
    const list = await a.as.get('/api/admin/admins')
    const flags = Object.fromEntries(list.body.admins.map((x: { id: string; is_super_admin: boolean }) => [x.id, x.is_super_admin]))
    expect(flags[a.userId]).toBe(true)
    expect(flags[b.userId]).toBe(true)
  })

  it('once super admins exist, an ordinary admin cannot manage admins or platform settings', async () => {
    const a = await admin('sa-a3@example.com')
    const c = await admin('sa-c3@example.com')
    await pool.query(`INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, 'super_admin')`, [a.userId])
    await createUser({ email: 'sa-target3@example.com', password: 'Str0ng!Pass' })

    expect((await c.as.get('/api/auth/me')).body.isSuperAdmin).toBe(false)
    expect((await c.as.post('/api/admin/admins').send({ email: 'sa-target3@example.com' })).status).toBe(403)
    expect((await c.as.delete(`/api/admin/admins/${a.userId}`)).status).toBe(403)
    expect((await c.as.patch('/api/admin/platform-settings').send({})).status).toBe(403)
    expect((await c.as.post(`/api/admin/users/${a.userId}/suspend`)).status).toBe(403)
    // ...but ordinary admin work still works
    expect((await c.as.get('/api/admin/users')).status).toBe(200)

    expect((await a.as.post('/api/admin/admins').send({ email: 'sa-target3@example.com' })).status).toBe(200)
  })

  it('the last super admin cannot be removed, and nobody can remove their own super access', async () => {
    const a = await admin('sa-a4@example.com')
    const b = await admin('sa-b4@example.com')
    await pool.query(`INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, 'super_admin')`, [a.userId])
    expect((await a.as.delete(`/api/admin/admins/${a.userId}/super`)).status).toBe(400)

    expect((await a.as.post(`/api/admin/admins/${b.userId}/super`)).status).toBe(200)
    expect((await a.as.delete(`/api/admin/admins/${b.userId}/super`)).status).toBe(200)
    // b is back to an ordinary admin; a is the only super admin again
    expect((await b.as.delete(`/api/admin/admins/${a.userId}/super`)).status).toBe(403)
  })

  it('removing admin access from a super admin also removes super access', async () => {
    const a = await admin('sa-a5@example.com')
    const b = await admin('sa-b5@example.com')
    await pool.query(`INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, 'super_admin'), (?, 'super_admin')`, [a.userId, b.userId])
    expect((await a.as.delete(`/api/admin/admins/${b.userId}`)).status).toBe(200)
    const [rows] = await pool.query(`SELECT role_code FROM platform_user_roles WHERE user_id = ?`, [b.userId])
    expect(rows).toEqual([])
  })

  it('only an existing admin can be made a super admin', async () => {
    const a = await admin('sa-a6@example.com')
    const plain = await createUser({ email: 'sa-plain6@example.com', password: 'Str0ng!Pass' })
    expect((await a.as.post(`/api/admin/admins/${plain}/super`)).status).toBe(400)
  })
})
