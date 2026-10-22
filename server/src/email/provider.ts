import nodemailer, { type Transporter } from 'nodemailer'
import { env, isProduction } from '../config/env.js'

export type SendMailInput = { to: string; subject: string; html: string; text: string }
export type SendMailResult = { providerMessageId?: string }

export interface MailProvider {
  sendMail(input: SendMailInput): Promise<SendMailResult>
}

/**
 * Prints the email instead of sending it. Content (including any secret
 * link) is only logged outside production — see the module doc for why: a
 * misconfigured deploy left on EMAIL_MODE=console must never leak a reset
 * link to the server log in prod. It still "succeeds" either way so queued
 * rows land in email_logs as sent, not stuck.
 */
const consoleProvider: MailProvider = {
  async sendMail(input) {
    if (!isProduction) {
      console.log(`\n--- [console email] To: ${input.to} ---`)
      console.log(`Subject: ${input.subject}`)
      console.log(input.text)
      console.log('--- end email ---\n')
    }
    return {}
  },
}

let smtpTransport: Transporter | null = null

function getSmtpTransport(): Transporter {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 465,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  }
  return smtpTransport
}

const smtpProvider: MailProvider = {
  async sendMail(input) {
    const transport = getSmtpTransport()
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    return { providerMessageId: info.messageId }
  },
}

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

/**
 * Parses MAIL_FROM into the { name, email } shape Brevo's /v3/smtp/email
 * expects for `sender`. Accepts either "Display Name <email@x.com>" (RFC
 * 5322 mailbox form) or a plain "email@x.com". Brevo rejects the raw
 * "Name <email>" string as an invalid `sender.email` (400 invalid_parameter).
 */
export function parseMailFrom(raw: string): { name?: string; email: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  if (match && match[2]) {
    const name = match[1]
    const email = match[2]
    return name ? { name, email } : { email }
  }
  return { email: raw.trim() }
}

/**
 * Sends over Brevo's transactional email HTTP API (plain HTTPS, port 443)
 * instead of SMTP - Render's FREE web services block the outbound SMTP
 * ports (25/465/587), so this is what makes email work there without
 * upgrading to a paid Render plan. Same queue/retry/redaction/logging as the
 * SMTP provider: the worker (worker.ts) treats every MailProvider the same,
 * it never knows which transport it's using.
 */
/** Exported (unlike smtpProvider) so tests can exercise the real HTTP call shape against a mocked fetch. */
export const brevoProvider: MailProvider = {
  async sendMail(input) {
    const res = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'api-key': env.BREVO_API_KEY ?? '',
      },
      body: JSON.stringify({
        sender: parseMailFrom(env.MAIL_FROM ?? ''),
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html || undefined,
        textContent: input.text || undefined,
      }),
    })

    if (!res.ok) {
      // Brevo's error body can be large/unpredictable - cap what ends up in
      // email_logs.error_message (worker.ts also truncates to 1000 chars).
      const body = await res.text().catch(() => '')
      throw new Error(`Brevo API error ${res.status}: ${body.slice(0, 500)}`)
    }

    const data = (await res.json().catch(() => ({}))) as { messageId?: string }
    return { providerMessageId: data.messageId }
  },
}

let providerOverride: MailProvider | null = null

/** Test-only seam: swaps in a mocked transport so the worker's own logic (retries, redaction, ...) can be tested without ever touching real SMTP/Gmail/Brevo. */
export function setMailProviderForTesting(provider: MailProvider | null): void {
  providerOverride = provider
}

/** Behind one interface so another provider (e.g. Resend) can be added later by changing only server/.env. */
export function getMailProvider(): MailProvider {
  if (providerOverride) return providerOverride
  if (env.EMAIL_MODE === 'smtp') return smtpProvider
  if (env.EMAIL_MODE === 'brevo') return brevoProvider
  return consoleProvider
}
