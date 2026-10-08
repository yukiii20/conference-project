// Supabase Edge Function: invite-convenor
//
// Invites a new convenor by email instead of setting a temporary password.
// Needs the service_role key to call auth.admin.inviteUserByEmail(), which
// must never reach the React app — hence this runs server-side.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SITE_URL = Deno.env.get('SITE_URL') ?? ''

const ALLOWED_ORIGIN = 'http://localhost:5173'

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

/** Normalises a Nepal mobile number (with or without +977) to +977XXXXXXXXXX. */
function normalizePhone(raw: string): string | null {
  let digits = raw.trim().replace(/[\s-]/g, '').replace(/^\+/, '')
  if (digits.startsWith('977')) {
    digits = digits.slice(3)
  }
  if (/^(97|98)\d{8}$/.test(digits)) {
    return `+977${digits}`
  }
  return null
}

type InvitePayload = {
  conference_id?: string
  email?: string
  full_name?: string
  phone?: string
}

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

  let payload: InvitePayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  // Step 1: verify the caller is an admin, using THEIR Authorization header
  // (never the service role) so the database's own RLS/role check applies.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: rolesData, error: rolesError } = await callerClient.rpc('get_my_roles')
  if (rolesError) {
    return jsonResponse({ error: rolesError.message }, 403)
  }
  const roles = (rolesData ?? []) as Array<{ role_code: string }>
  const isAdmin = roles.some((r) => r.role_code === 'admin')
  if (!isAdmin) {
    return jsonResponse({ error: 'Only the administrator can invite a convenor.' }, 403)
  }

  // Step 2: validate input
  const conferenceId = payload.conference_id?.trim()
  const email = payload.email?.trim().toLowerCase()
  const fullName = payload.full_name?.trim()
  const phoneRaw = payload.phone?.trim()

  if (!conferenceId) {
    return jsonResponse({ error: 'Choose a conference.' }, 400)
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400)
  }
  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    return jsonResponse({ error: 'Full name must be 2-100 characters.' }, 400)
  }
  if (!phoneRaw) {
    return jsonResponse({ error: 'Phone number is required.' }, 400)
  }
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    return jsonResponse(
      { error: 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.' },
      400,
    )
  }

  // Step 3: invite via the service-role client. If the account already
  // exists, skip the invite and continue straight to appointing it.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let invited = false
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, phone },
    redirectTo: `${SITE_URL}/set-password`,
  })

  if (inviteError) {
    const code = (inviteError as { code?: string }).code
    const alreadyExists =
      code === 'email_exists' || inviteError.message?.toLowerCase().includes('already')
    if (!alreadyExists) {
      return jsonResponse({ error: inviteError.message }, 400)
    }
  } else {
    invited = true
  }

  // Step 4: appoint using the CALLER's client (not service role), so the
  // database's own "admin only" check in appoint_convenor still applies.
  const { error: appointError } = await callerClient.rpc('appoint_convenor', {
    p_conference_id: conferenceId,
    p_email: email,
  })

  if (appointError) {
    return jsonResponse({ error: appointError.message }, 400)
  }

  return jsonResponse({ invited, appointed: true })
})
