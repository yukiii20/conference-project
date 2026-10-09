import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { ensureStorageDirs } from '../src/storage/paths.js'
import {
  addConferenceMember,
  createConference,
  createUser,
  exeBuffer,
  oversizedBuffer,
  pdfBuffer,
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

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'convenor' })
  expect(login.status).toBe(200)
  return agent
}

describe('cross-conference authorization', () => {
  it('403s a convenor of conference A editing conference B', async () => {
    const conferenceA = await createConference({ slug: 'conf-a' })
    const conferenceB = await createConference({ slug: 'conf-b' })
    const agentA = await loginAsConvenor(conferenceA, 'convenor-a@example.com')

    const res = await agentA.patch(`/api/conferences/${conferenceB}`).send({ name: 'Hijacked Name' })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/conferences/:id', () => {
  it('updates only the submitted fields, leaving others untouched', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'convenor@example.com')

    const first = await agent.patch(`/api/conferences/${conferenceId}`).send({ tagline: 'First tagline' })
    expect(first.status).toBe(200)

    const second = await agent.patch(`/api/conferences/${conferenceId}`).send({ theme: 'AI and Society' })
    expect(second.status).toBe(200)

    const [rows] = await pool.query('SELECT tagline, theme FROM conferences WHERE id = ?', [conferenceId])
    const row = (rows as Array<{ tagline: string | null; theme: string | null }>)[0]!
    expect(row.tagline).toBe('First tagline')
    expect(row.theme).toBe('AI and Society')
  })
})

describe('logo upload validation', () => {
  it('accepts a real PNG', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'logo-ok@example.com')

    const res = await agent
      .post(`/api/conferences/${conferenceId}/logo`)
      .attach('file', await pngBuffer(), 'logo.png')
    expect(res.status).toBe(200)
    expect(res.body.path).toMatch(/\.png$/)
  })

  it('rejects a real PDF renamed to look like a PNG', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'logo-pdf@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/logo`).attach('file', pdfBuffer(), 'logo.png')
    expect(res.status).toBe(400)
  })

  it('rejects a real .exe renamed to look like a PNG', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'logo-exe@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/logo`).attach('file', exeBuffer(), 'logo.png')
    expect(res.status).toBe(400)
  })

  it('rejects a file over the 2MB logo limit', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'logo-big@example.com')

    const res = await agent
      .post(`/api/conferences/${conferenceId}/logo`)
      .attach('file', oversizedBuffer(3 * 1024 * 1024), 'logo.png')
    expect(res.status).toBe(400)
  })
})
