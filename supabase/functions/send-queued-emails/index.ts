// Supabase Edge Function: send-queued-emails
//
// Sends whatever the database has already queued in public.email_logs — it
// never decides what to send, only how. Any signed-in user may call it (it
// does nothing a caller could abuse beyond flushing the existing queue).
// Picks up to 20 queued rows (attempts < 3, oldest first), resolves each
// one's template (conference-specific first, then global), fills in
// {{placeholders}} with HTML-escaped values, and sends via Gmail SMTP.

import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? ''
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? ''

const ALLOWED_ORIGIN = 'http://localhost:5173'
const BATCH_SIZE = 20
const MAX_ATTEMPTS = 3

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fillTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => escapeHtml(data[key]))
}

type EmailLogRow = {
  id: number
  conference_id: string | null
  recipient_email: string
  subject: string
  template_key: string
  template_data: Record<string, unknown>
  attempts: number
}

type TemplateRow = { subject: string; body_html: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header.' }, 401)
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Function is not configured correctly.' }, 500)
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return jsonResponse({ error: 'Email sending is not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD).' }, 500)
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Not signed in.' }, 401)
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: rows, error: fetchError } = await adminClient
    .from('email_logs')
    .select('id, conference_id, recipient_email, subject, template_key, template_data, attempts')
    .eq('status', 'queued')
    .lt('attempts', MAX_ATTEMPTS)
    .order('queued_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    return jsonResponse({ error: fetchError.message }, 500)
  }

  const queue = (rows ?? []) as EmailLogRow[]
  if (queue.length === 0) {
    return jsonResponse({ sent: 0, failed: 0 })
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  })

  let sent = 0
  let failed = 0

  for (const row of queue) {
    try {
      let template: TemplateRow | null = null

      if (row.conference_id) {
        const { data } = await adminClient
          .from('email_templates')
          .select('subject, body_html')
          .eq('template_key', row.template_key)
          .eq('conference_id', row.conference_id)
          .eq('is_active', true)
          .maybeSingle()
        template = data
      }
      if (!template) {
        const { data } = await adminClient
          .from('email_templates')
          .select('subject, body_html')
          .eq('template_key', row.template_key)
          .is('conference_id', null)
          .eq('is_active', true)
          .maybeSingle()
        template = data
      }

      if (!template) {
        throw new Error(`No active email template found for "${row.template_key}".`)
      }

      const data = row.template_data ?? {}
      const subject = fillTemplate(template.subject, data)
      const html = fillTemplate(template.body_html, data)

      await transporter.sendMail({
        from: `"Conference Portal" <${GMAIL_USER}>`,
        to: row.recipient_email,
        subject,
        html,
      })

      await adminClient
        .from('email_logs')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null })
        .eq('id', row.id)
      sent += 1
    } catch (err) {
      const nextAttempts = row.attempts + 1
      const message = err instanceof Error ? err.message : String(err)
      await adminClient
        .from('email_logs')
        .update({
          attempts: nextAttempts,
          error_message: message,
          status: nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        })
        .eq('id', row.id)
      failed += 1
    }
  }

  return jsonResponse({ sent, failed })
})
