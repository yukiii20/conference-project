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

let providerOverride: MailProvider | null = null

/** Test-only seam: swaps in a mocked transport so the worker's own logic (retries, redaction, ...) can be tested without ever touching real SMTP/Gmail. */
export function setMailProviderForTesting(provider: MailProvider | null): void {
  providerOverride = provider
}

/** Behind one interface so another provider (e.g. Resend) can be added later by changing only server/.env. */
export function getMailProvider(): MailProvider {
  if (providerOverride) return providerOverride
  return env.EMAIL_MODE === 'smtp' ? smtpProvider : consoleProvider
}
