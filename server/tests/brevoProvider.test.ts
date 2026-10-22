import { afterEach, describe, expect, it, vi } from 'vitest'
import { brevoProvider, parseMailFrom } from '../src/email/provider.js'
import { env } from '../src/config/env.js'

const INPUT = { to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

const ORIGINAL_MAIL_FROM = env.MAIL_FROM

afterEach(() => {
  vi.unstubAllGlobals()
  env.MAIL_FROM = ORIGINAL_MAIL_FROM
})

describe('parseMailFrom', () => {
  it('parses "Display Name <email>" into { name, email }', () => {
    expect(parseMailFrom('Conference CMS <conferencemanagment4@gmail.com>')).toEqual({
      name: 'Conference CMS',
      email: 'conferencemanagment4@gmail.com',
    })
  })

  it('parses a plain email address into { email } with no name', () => {
    expect(parseMailFrom('conferencemanagment4@gmail.com')).toEqual({
      email: 'conferencemanagment4@gmail.com',
    })
  })
})

describe('brevo email provider (mocked fetch - no real emails sent)', () => {
  it('sends the exact request shape Brevo expects, with sender split into { name, email }', async () => {
    env.MAIL_FROM = 'Conference CMS <conferencemanagment4@gmail.com>'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messageId: 'brevo-123' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await brevoProvider.sendMail(INPUT)

    expect(result).toEqual({ providerMessageId: 'brevo-123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['api-key']).toBeDefined()
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')

    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      sender: { name: 'Conference CMS', email: 'conferencemanagment4@gmail.com' },
      to: [{ email: INPUT.to }],
      subject: INPUT.subject,
      htmlContent: INPUT.html,
      textContent: INPUT.text,
    })
  })

  it('splits a plain-email MAIL_FROM (no display name) into sender.email with no name field', async () => {
    env.MAIL_FROM = 'conferencemanagment4@gmail.com'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messageId: 'brevo-456' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await brevoProvider.sendMail(INPUT)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.sender).toEqual({ email: 'conferencemanagment4@gmail.com' })
  })

  it('throws (so the worker retries/records the failure) when Brevo responds with an error status', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"message":"invalid api key"}',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(brevoProvider.sendMail(INPUT)).rejects.toThrow(/Brevo API error 401/)
  })

  it('never throws on a malformed success body - still resolves without a provider message id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('not json')
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await brevoProvider.sendMail(INPUT)
    expect(result).toEqual({ providerMessageId: undefined })
  })
})
