import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { PUBLIC_DIR } from '../src/storage/paths.js'
import { ensureStorageDirs } from '../src/storage/paths.js'
import { addConferenceMember, createConference, createUser, jpgBuffer, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
  await ensureStorageDirs()
})

afterAll(async () => {
  await pool.end()
})

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'convenor' })
  expect(login.status).toBe(200)
  return agent
}

describe('conference supporters CRUD', () => {
  it('adds, edits, reorders, and deletes a supporter', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'supporters@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/supporters`)
      .send({ name: 'Acme Corp', tier: 'sponsor', website_url: 'https://acme.example' })
    expect(create.status).toBe(201)
    const supporterId = create.body.id

    const edit = await agent
      .patch(`/api/conferences/${conferenceId}/supporters/${supporterId}`)
      .send({ name: 'Acme Corporation' })
    expect(edit.status).toBe(200)

    const [rows] = await pool.query('SELECT name FROM conference_supporters WHERE id = ?', [supporterId])
    expect((rows as Array<{ name: string }>)[0]!.name).toBe('Acme Corporation')

    const del = await agent.delete(`/api/conferences/${conferenceId}/supporters/${supporterId}`)
    expect(del.status).toBe(200)

    const [afterRows] = await pool.query('SELECT id FROM conference_supporters WHERE id = ?', [supporterId])
    expect((afterRows as unknown[]).length).toBe(0)
  })

  it('rejects a website_url without http(s)://', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'supporters-url@example.com')

    const res = await agent
      .post(`/api/conferences/${conferenceId}/supporters`)
      .send({ name: 'Bad URL Co', tier: 'sponsor', website_url: 'acme.example' })
    expect(res.status).toBe(400)
  })
})

describe('supporter logo upload', () => {
  it('accepts a real JPG, stores it under storage/public, and replacing it removes the old file', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'supporters-logo@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/supporters`)
      .send({ name: 'Logo Co', tier: 'sponsor' })
    const supporterId = create.body.id

    const first = await agent
      .post(`/api/conferences/${conferenceId}/supporters/${supporterId}/logo`)
      .attach('file', await jpgBuffer(), 'logo.jpg')
    expect(first.status).toBe(200)
    expect(first.body.path).toMatch(/\.jpg$/)

    const firstFullPath = path.join(PUBLIC_DIR, first.body.path)
    expect(existsSync(firstFullPath)).toBe(true)
    // The stored path must be a server-generated UUID, never the client's
    // original filename or anything that could traverse out of PUBLIC_DIR.
    expect(first.body.path).not.toContain('..')
    expect(first.body.path).not.toContain('logo.jpg')
    expect(path.resolve(firstFullPath).startsWith(path.resolve(PUBLIC_DIR))).toBe(true)

    const second = await agent
      .post(`/api/conferences/${conferenceId}/supporters/${supporterId}/logo`)
      .attach('file', await jpgBuffer(), 'logo2.jpg')
    expect(second.status).toBe(200)
    expect(second.body.path).not.toBe(first.body.path)
    expect(existsSync(firstFullPath)).toBe(false)
    expect(existsSync(path.join(PUBLIC_DIR, second.body.path))).toBe(true)
  })
})

describe('authorization', () => {
  it('is forbidden for an unauthenticated caller', async () => {
    const conferenceId = await createConference()
    const res = await request(app).get(`/api/conferences/${conferenceId}/supporters`)
    expect(res.status).toBe(401)
  })
})
