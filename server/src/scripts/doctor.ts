/**
 * Diagnostic check for local setup problems. Run with `npm run doctor` from
 * server/. Prints what's wrong (missing .env vars, unreachable MySQL, missing
 * tables) without ever printing secret values.
 */
import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const REQUIRED_VARS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET', 'CLIENT_ORIGIN']

const EXPECTED_TABLES = [
  'announcements', 'audit_logs', 'auth_sessions', 'auth_tokens', 'certificate_templates',
  'certificates', 'committee_members', 'committees', 'conference_attendance', 'conference_counters',
  'conference_deadlines', 'conference_members', 'conference_sessions', 'conference_settings',
  'conference_speakers', 'conference_supporters', 'conference_tracks', 'conferences',
  'conflicts_of_interest', 'deadline_extensions', 'deadline_types', 'email_logs', 'email_templates',
  'notifications', 'payment_webhook_events', 'payments', 'permissions', 'platform_user_roles',
  'presentations', 'registration_categories', 'registration_fees', 'registrations',
  'review_assignments', 'reviewer_tracks', 'reviews', 'role_permissions', 'role_requests', 'roles',
  'rooms', 'schedule_slots', 'session_attendance', 'session_chairs', 'submission_authors',
  'submission_decisions', 'submission_files', 'submission_status_history', 'submissions', 'users',
]

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`)
}

async function main() {
  console.log('Conference CMS - setup doctor\n')

  line('Node version', process.version)

  const envPath = path.resolve(process.cwd(), '.env')
  const envExists = existsSync(envPath)
  line('.env file', envExists ? 'found' : 'MISSING - copy server/.env.example to server/.env')

  if (!envExists) {
    console.log('\nStop here: create server/.env first, then run this again.')
    process.exitCode = 1
    return
  }

  const missing = REQUIRED_VARS.filter((name) => !process.env[name] || process.env[name]!.trim() === '')
  line('Required variables', missing.length === 0 ? 'all present' : `MISSING: ${missing.join(', ')}`)

  const emailMode = process.env.EMAIL_MODE ?? 'console'
  line('EMAIL_MODE', emailMode)
  if (emailMode === 'smtp') {
    const smtpMissing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].filter(
      (name) => !process.env[name] || process.env[name]!.trim() === '',
    )
    if (smtpMissing.length > 0) {
      line('SMTP config', `MISSING: ${smtpMissing.join(', ')}`)
    } else {
      line('SMTP config', 'all present (values not checked)')
    }
  }

  if (missing.length > 0) {
    console.log('\nFix the missing variables above, then run this again.')
    process.exitCode = 1
    return
  }

  let conn: mysql.Connection | undefined
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 5000,
    })
    const started = Date.now()
    await conn.query('SELECT 1')
    line('MySQL connection', `OK (${Date.now() - started} ms)`)

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = ?',
      [process.env.DB_NAME],
    )
    const present = new Set((rows as Array<{ table_name: string }>).map((r) => r.table_name))
    const missingTables = EXPECTED_TABLES.filter((t) => !present.has(t))
    if (missingTables.length === 0) {
      line('Database tables', `all ${EXPECTED_TABLES.length} core tables present (${present.size} total)`)
    } else {
      line('Database tables', `MISSING: ${missingTables.join(', ')}`)
    }
  } catch (err) {
    line('MySQL connection', `FAILED - ${err instanceof Error ? err.message : String(err)}`)
    console.log('\nCheck DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME and that MySQL is running.')
    process.exitCode = 1
  } finally {
    await conn?.end().catch(() => {})
  }

  console.log('\nDone.')
}

main()
