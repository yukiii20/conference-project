import { afterEach, describe, expect, it, vi } from 'vitest'
import { brevoProvider } from '../src/email/provider.js'

const INPUT = { to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('brevo email provider (mocked fetch - no real emails sent)', () => {
  it('posts to the Brevo transactional email API and returns the provider message id', async () => {
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
    const body = JSON.parse(init.body as string)
    expect(body.to).toEqual([{ email: INPUT.to }])
    expect(body.subject).toBe(INPUT.subject)
    expect(body.htmlContent).toBe(INPUT.html)
    expect(body.textContent).toBe(INPUT.text)
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
