import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createTickRouter, runTick, type TickJob } from '../src/jobs/tick.js'

const SECRET = 'cron-secret-that-is-long-enough-123'

function appWith(secret: string | undefined, jobs: TickJob[]) {
  const app = express()
  app.use(express.json())
  app.use('/api/internal', createTickRouter({ secret: () => secret, jobs }))
  return app
}

describe('runTick', () => {
  it('runs every job, and one failure does not stop the rest', async () => {
    const ran: string[] = []
    const result = await runTick([
      { name: 'a', run: async () => ran.push('a') },
      { name: 'b', run: async () => { throw new Error('boom') } },
      { name: 'c', run: async () => ran.push('c') },
    ])
    expect(ran).toEqual(['a', 'c'])
    expect(result).toEqual({ a: 'ok', b: 'failed', c: 'ok' })
  })
})

describe('POST /api/internal/tick', () => {
  const job = (): { calls: number; jobs: TickJob[] } => {
    const state = { calls: 0, jobs: [] as TickJob[] }
    state.jobs = [{ name: 'x', run: async () => { state.calls += 1 } }]
    return state
  }

  it('is off (404) without CRON_SECRET', async () => {
    const s = job()
    await request(appWith(undefined, s.jobs)).post('/api/internal/tick').set('Authorization', `Bearer ${SECRET}`).expect(404)
    expect(s.calls).toBe(0)
  })
  it('rejects a missing or wrong token', async () => {
    const s = job()
    const app = appWith(SECRET, s.jobs)
    await request(app).post('/api/internal/tick').expect(401)
    await request(app).post('/api/internal/tick').set('Authorization', 'Bearer nope').expect(401)
    expect(s.calls).toBe(0)
  })
  it('runs the jobs with the right token', async () => {
    const s = job()
    const res = await request(appWith(SECRET, s.jobs)).post('/api/internal/tick').set('Authorization', `Bearer ${SECRET}`).expect(200)
    expect(res.body).toEqual({ jobs: { x: 'ok' } })
    expect(s.calls).toBe(1)
  })
  it('does not start a second tick while one is running', async () => {
    let release!: () => void
    const app = appWith(SECRET, [{ name: 'slow', run: () => new Promise<void>((r) => (release = r)) }])
    const first = request(app).post('/api/internal/tick').set('Authorization', `Bearer ${SECRET}`).then((r) => r)
    await new Promise((r) => setTimeout(r, 50))
    await request(app).post('/api/internal/tick').set('Authorization', `Bearer ${SECRET}`).expect(202)
    release()
    expect((await first).status).toBe(200)
  })
})
