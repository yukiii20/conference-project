// Supabase Edge Function: submission-upload
//
// Two actions, both requiring the caller's own JWT (never the service role,
// which only comes in server-side once authorship is verified):
//   - "start":  mint a signed upload URL for a new file version.
//   - "finish": read the uploaded object's real size/mime from storage and
//               insert the submission_files row. If the database rejects it
//               (wrong status, window closed, bad type/size), the uploaded
//               object is deleted and the database's own message is returned.
//
// Clients can't insert submission_files rows or upload to the private
// "submissions" bucket directly — this function is the only path in. Authors
// cannot delete submitted files; a new upload adds the next version instead.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const ALLOWED_ORIGIN = 'http://localhost:5173'
const BUCKET = 'submissions'
const FILE_KINDS = ['abstract', 'full_paper', 'camera_ready', 'supplementary', 'slides']

const DOC_EXTENSIONS = ['pdf', 'doc', 'docx']
const DOC_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const SLIDE_EXTENSIONS = ['pdf', 'ppt', 'pptx']
const SLIDE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

// abstract and supplementary additionally accept images (e.g. a photographed
// or scanned abstract); full_paper and camera_ready stay document-only;
// slides stay presentation-only.
const FILE_KIND_RULES: Record<string, { extensions: string[]; mimeTypes: string[] }> = {
  abstract: { extensions: [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS], mimeTypes: [...DOC_MIME_TYPES, ...IMAGE_MIME_TYPES] },
  supplementary: { extensions: [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS], mimeTypes: [...DOC_MIME_TYPES, ...IMAGE_MIME_TYPES] },
  full_paper: { extensions: DOC_EXTENSIONS, mimeTypes: DOC_MIME_TYPES },
  camera_ready: { extensions: DOC_EXTENSIONS, mimeTypes: DOC_MIME_TYPES },
  slides: { extensions: SLIDE_EXTENSIONS, mimeTypes: SLIDE_MIME_TYPES },
}

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

function safeExtension(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,10})$/.exec(filename)
  return (match?.[1] ?? 'bin').toLowerCase()
}

type Payload = {
  action?: 'start' | 'finish'
  submission_id?: string
  file_kind?: string
  filename?: string
  size?: number
  mime?: string
  path?: string
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

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const fileKind = payload.file_kind
  const submissionId = payload.submission_id?.trim()

  if (!submissionId) {
    return jsonResponse({ error: 'Missing submission_id.' }, 400)
  }
  if (!fileKind || !FILE_KINDS.includes(fileKind)) {
    return jsonResponse({ error: 'Invalid file_kind.' }, 400)
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Not signed in.' }, 401)
  }
  const callerId = userData.user.id

  // Verify the caller can see this submission and is one of its authors
  // (creator or listed in submission_authors), using THEIR client so the
  // database's own RLS applies — never trust the client's say-so alone.
  const { data: submission, error: submissionError } = await callerClient
    .from('submissions')
    .select('id, conference_id, created_by')
    .eq('id', submissionId)
    .maybeSingle()

  if (submissionError) {
    return jsonResponse({ error: submissionError.message }, 400)
  }
  if (!submission) {
    return jsonResponse({ error: 'Submission not found.' }, 404)
  }

  let isAuthor = submission.created_by === callerId
  if (!isAuthor) {
    const { data: authorRow } = await callerClient
      .from('submission_authors')
      .select('id')
      .eq('submission_id', submissionId)
      .eq('user_id', callerId)
      .maybeSingle()
    isAuthor = Boolean(authorRow)
  }
  if (!isAuthor) {
    return jsonResponse({ error: 'You are not an author of this submission.' }, 403)
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const rule = FILE_KIND_RULES[fileKind]

  if (payload.action === 'start') {
    const filename = payload.filename?.trim()
    if (!filename) {
      return jsonResponse({ error: 'Missing filename.' }, 400)
    }

    const ext = safeExtension(filename)
    if (!rule.extensions.includes(ext)) {
      return jsonResponse(
        { error: `That file type isn't allowed for this field. Use: ${rule.extensions.join(', ').toUpperCase()}.` },
        400,
      )
    }
    const path = `${submission.conference_id}/${submissionId}/${fileKind}/v-${crypto.randomUUID()}.${ext}`

    const { data, error } = await adminClient.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? 'Could not create upload URL.' }, 400)
    }

    return jsonResponse({ path: data.path, token: data.token, signedUrl: data.signedUrl })
  }

  if (payload.action === 'finish') {
    const path = payload.path?.trim()
    const filename = payload.filename?.trim()
    if (!path || !filename) {
      return jsonResponse({ error: 'Missing path or filename.' }, 400)
    }
    if (!path.startsWith(`${submission.conference_id}/${submissionId}/${fileKind}/`)) {
      return jsonResponse({ error: 'Path does not match this submission.' }, 400)
    }

    const slash = path.lastIndexOf('/')
    const folder = path.slice(0, slash)
    const objectName = path.slice(slash + 1)

    const { data: listing, error: listError } = await adminClient.storage.from(BUCKET).list(folder, {
      search: objectName,
    })
    const object = listing?.find((o) => o.name === objectName)

    if (listError || !object) {
      return jsonResponse({ error: 'Uploaded file not found. Please try again.' }, 400)
    }

    const sizeBytes = (object.metadata as { size?: number } | null)?.size ?? 0
    const mimeType = (object.metadata as { mimetype?: string } | null)?.mimetype ?? 'application/octet-stream'

    if (!rule.mimeTypes.includes(mimeType)) {
      await adminClient.storage.from(BUCKET).remove([path])
      return jsonResponse(
        { error: `That file type isn't allowed for this field. Use: ${rule.extensions.join(', ').toUpperCase()}.` },
        400,
      )
    }

    const { data: fileRow, error: insertError } = await adminClient
      .from('submission_files')
      .insert({
        submission_id: submissionId,
        file_kind: fileKind as
          | 'abstract'
          | 'full_paper'
          | 'camera_ready'
          | 'supplementary'
          | 'slides',
        storage_bucket: BUCKET,
        storage_path: path,
        original_filename: filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        version: 1, // the database assigns the real version number on insert
        uploaded_by: callerId,
      })
      .select()
      .single()

    if (insertError) {
      await adminClient.storage.from(BUCKET).remove([path])
      return jsonResponse({ error: insertError.message }, 400)
    }

    return jsonResponse({ file: fileRow })
  }

  return jsonResponse({ error: 'Invalid action.' }, 400)
})
