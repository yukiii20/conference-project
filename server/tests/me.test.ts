import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { PUBLIC_DIR, ensureStorageDirs } from '../src/storage/paths.js'
import {
  createConference,
  createRoleRequest,
  createUser,
  exeBuffer,
  oversizedBuffer,
  pngBuffer,
  resetDatabase,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
  await ensureStorageDirs()
})

afterAll(async () => {
  await pool.end()
})

describe('PATCH /api/me/profile', () => {
  it('cannot change the email address (the field does not exist on this endpoint)', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'person@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'person@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(login.status).toBe(200)

    const res = await agent
      .patch('/api/me/profile')
      .send({ full_name: 'New Name', email: 'hacked@example.com', status: 'suspended' })
    expect(res.status).toBe(200)
    expect(res.body.user.full_name).toBe('New Name')
    expect(res.body.user.email).toBe('person@example.com')

    const [rows] = await pool.query('SELECT email, status FROM users WHERE id = ?', [userId])
    const row = (rows as Array<{ email: string; status: string }>)[0]!
    expect(row.email).toBe('person@example.com')
    expect(row.status).toBe('active')
  })

  it('updates the phone number', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'phoneperson@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: 'phoneperson@example.com', password: 'Str0ng!Pass', role: 'author' })

    const res = await agent.patch('/api/me/profile').send({ phone: '9811111111' })
    expect(res.status).toBe(200)
    expect(res.body.user.phone).toBe('+9779811111111')

    const [rows] = await pool.query('SELECT phone FROM users WHERE id = ?', [userId])
    expect((rows as Array<{ phone: string }>)[0]!.phone).toBe('+9779811111111')
  })

  it('rejects an invalid phone number', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'badphone@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: 'badphone@example.com', password: 'Str0ng!Pass', role: 'author' })

    const res = await agent.patch('/api/me/profile').send({ phone: '123' })
    expect(res.status).toBe(400)
  })
})

describe('profile photo', () => {
  async function loginAsAuthor(email: string, conferenceId: string) {
    const userId = await createUser({ email, password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')
    const agent = request.agent(app)
    const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'author' })
    expect(login.status).toBe(200)
    return agent
  }

  it('uploads a photo, then replacing it removes the previous file', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsAuthor('photo@example.com', conferenceId)

    const first = await agent.post('/api/me/photo').attach('file', await pngBuffer(), 'me.png')
    expect(first.status).toBe(200)
    const firstFullPath = path.join(PUBLIC_DIR, first.body.path)
    expect(existsSync(firstFullPath)).toBe(true)

    const second = await agent.post('/api/me/photo').attach('file', await pngBuffer(), 'me2.png')
    expect(second.status).toBe(200)
    expect(second.body.path).not.toBe(first.body.path)
    expect(existsSync(firstFullPath)).toBe(false)
    expect(existsSync(path.join(PUBLIC_DIR, second.body.path))).toBe(true)
  })

  it('rejects a non-image file renamed to look like a PNG', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsAuthor('photo-fake@example.com', conferenceId)

    const res = await agent.post('/api/me/photo').attach('file', exeBuffer(), 'me.png')
    expect(res.status).toBe(400)
  })

  it('rejects a photo over the 5MB limit', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsAuthor('photo-big@example.com', conferenceId)

    const res = await agent.post('/api/me/photo').attach('file', oversizedBuffer(6 * 1024 * 1024), 'me.png')
    expect(res.status).toBe(400)
  })

  it('removes the photo', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsAuthor('photo-remove@example.com', conferenceId)

    const upload = await agent.post('/api/me/photo').attach('file', await pngBuffer(), 'me.png')
    const fullPath = path.join(PUBLIC_DIR, upload.body.path)
    expect(existsSync(fullPath)).toBe(true)

    const del = await agent.delete('/api/me/photo')
    expect(del.status).toBe(200)
    expect(existsSync(fullPath)).toBe(false)
  })
})
