import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createBrevoWebhookRouter } from '../src/modules/emailWebhooks/routes.js'
import { classifyBrevoEvent, normaliseMessageId, type BrevoEvent } from '../src/modules/emailWebhooks/service.js'

const SECRET = 'a-very-long-webhook-secret-123456'

function appWith(secret: string | undefined) {
  const seen: BrevoEvent[][] = []
  const app = express()
  app.use(express.json())
  app.use(
    '/api/webhooks',
    createBrevoWebhookRouter({ secret: () => secret, apply: async (events) => (seen.push(events), events.length) }),
  )
  return { app, seen }
}

describe('classifyBrevoEvent', () => {
  it('maps delivered and the final-failure events', () => {
    expect(classifyBrevoEvent({ event: 'delivered', 'message-id': '<abc@relay>' })).toEqual({ messageId: 'abc@relay', status: 'delivered', reason: null })
    expect(classifyBrevoEvent({ event: 'hard_bounce', 'message-id': 'abc@relay', reason: 'mailbox does not exist' })).toEqual({
      messageId: 'abc@relay',
      status: 'bounced',
      reason: 'Brevo: mailbox does not exist',
    })
    expect(classifyBrevoEvent({ event: 'blocked', 'message-id': 'x' })?.status).toBe('bounced')
    expect(classifyBrevoEvent({ event: 'invalid_email', 'message-id': 'x' })?.reason).toBe('Brevo: invalid email')
  })
  it('ignores events that do not change delivery status, and malformed payloads', () => {
    for (const event of ['soft_bounce', 'opened', 'click', 'request', 'deferred', 'unsubscribed']) {
      expect(classifyBrevoEvent({ event, 'message-id': 'x' })).toBeNull()
    }
    expect(classifyBrevoEvent({ event: 'delivered' })).toBeNull()
    expect(classifyBrevoEvent({ event: 'delivered', 'message-id': 42 })).toBeNull()
  })
  it('normalises bracketed message ids', () => {
    expect(normaliseMessageId(' <202611011234.1@smtp-relay.mailin.fr> ')).toBe('202611011234.1@smtp-relay.mailin.fr')
  })
})

describe('POST /api/webhooks/brevo', () => {
  const event = { event: 'delivered', 'message-id': '<m1@relay>', email: 'someone@example.test' }

  it('is switched off (404) when no secret is configured', async () => {
    const { app, seen } = appWith(undefined)
    await request(app).post('/api/webhooks/brevo').send(event).expect(404)
    expect(seen).toHaveLength(0)
  })
  it('rejects a missing or wrong token', async () => {
    const { app, seen } = appWith(SECRET)
    await request(app).post('/api/webhooks/brevo').send(event).expect(401)
    await request(app).post('/api/webhooks/brevo').set('Authorization', 'Bearer wrong').send(event).expect(401)
    await request(app).post('/api/webhooks/brevo?token=wrong').send(event).expect(401)
    expect(seen).toHaveLength(0)
  })
  it('accepts the bearer token or the ?token= form', async () => {
    const { app, seen } = appWith(SECRET)
    const a = await request(app).post('/api/webhooks/brevo').set('Authorization', `Bearer ${SECRET}`).send(event).expect(200)
    expect(a.body).toEqual({ received: 1, updated: 1 })
    await request(app).post(`/api/webhooks/brevo?token=${SECRET}`).send(event).expect(200)
    expect(seen).toEqual([[event], [event]])
  })
  it('accepts a batched array of events', async () => {
    const { app, seen } = appWith(SECRET)
    const res = await request(app).post('/api/webhooks/brevo').set('Authorization', `Bearer ${SECRET}`).send([event, event, 'junk']).expect(200)
    expect(res.body.received).toBe(2)
    expect(seen[0]).toHaveLength(2)
  })
})
