// After a contract run: compares the rows each backend wrote for the users of its own run
// (emails containing its RUN marker), with ids, timestamps and markers normalised.
//   node tests/contract/dbcompare.mjs <nodeRun> <phpRun>
// DB credentials come from server/.env (read here, never printed); always the test database.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '../../../server')
const require = createRequire(path.join(serverDir, 'package.json'))
const mysql = require('mysql2/promise')
const env = Object.fromEntries(
  fs.readFileSync(path.join(serverDir, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]
  }),
)
const [nodeRun, phpRun] = process.argv.slice(2)
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: 'conference_cms_test', timezone: 'Z' })

const QUERIES = {
  users: `SELECT email, full_name, phone, status, failed_login_count, locked_until IS NOT NULL AS locked, password_hash LIKE '$2%' AS bcrypt FROM users WHERE email LIKE ? ORDER BY email`,
  audit: `SELECT a.action, a.entity_type, a.old_values, a.new_values, a.user_agent FROM audit_logs a JOIN users u ON u.id = a.actor_user_id WHERE u.email LIKE ? ORDER BY a.occurred_at, a.action`,
  emails: `SELECT e.recipient_email, e.template_key, e.subject, e.template_data, e.status FROM email_logs e WHERE e.recipient_email LIKE ? ORDER BY e.queued_at, e.template_key`,
  role_requests: `SELECT r.role_code, r.status FROM role_requests r JOIN users u ON u.id = r.user_id WHERE u.email LIKE ? ORDER BY r.role_code`,
  members: `SELECT m.role_code, m.status FROM conference_members m JOIN users u ON u.id = m.user_id WHERE u.email LIKE ? ORDER BY m.role_code`,
  registrations: `SELECT r.status, r.amount_due, r.currency, LENGTH(r.qr_token) AS qr_len FROM registrations r JOIN users u ON u.id = r.user_id WHERE u.email LIKE ?`,
  sessions: `SELECT s.remember_me, s.is_admin_session, s.revoked_at IS NOT NULL AS revoked, TIMESTAMPDIFF(MINUTE, s.created_at, s.expires_at) AS ttl_min, LENGTH(s.token_hash) AS hash_len FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE ? ORDER BY s.created_at`,
}

const norm = (v, run) =>
  JSON.stringify(v, (k, x) => (x instanceof Date ? '<ts>' : x))
    .replaceAll(run, '<RUN>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/token=[A-Za-z0-9_-]{20,}/g, 'token=<token>')
    .replace(/-R\d{4}/g, '-R<n>')

let bad = 0
for (const [name, sql] of Object.entries(QUERIES)) {
  const [a] = await db.query(sql, [`%${nodeRun}%`])
  const [b] = await db.query(sql, [`%${phpRun}%`])
  const [x, y] = [norm(a, nodeRun), norm(b, phpRun)]
  if (x !== y) {
    bad++
    console.log(`DIFF ${name}\n  node: ${x}\n  php : ${y}`)
  } else console.log(`ok   ${name} (${a.length} rows)`)
}
await db.end()
process.exit(bad ? 1 : 0)
