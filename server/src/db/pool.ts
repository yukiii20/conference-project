import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

// DB_SSL_CA (the certificate text itself) wins when both are set - that's
// the shape a platform env var UI (Render, etc.) wants, pasted straight from
// the Aiven console. DB_SSL_CA_PATH is the alternative for a CA file that's
// actually on disk (e.g. checked into a secrets volume).
function loadSslCa(): string | undefined {
  if (env.DB_SSL_CA) return env.DB_SSL_CA
  if (env.DB_SSL_CA_PATH) return readFileSync(env.DB_SSL_CA_PATH, 'utf8')
  return undefined
}

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_POOL_SIZE,
  // Without this, an idle pooled connection to Aiven can be silently dropped
  // by a NAT/firewall between Render and Aiven, so the next request that
  // picks it up pays a full reconnect (and on a cross-region pair, a fresh
  // TLS handshake) instead of reusing a live socket. TCP keep-alive probes
  // every 10s keep the connection visibly alive instead.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  // Off by default (plain local MySQL). Aiven's free MySQL plan requires SSL
  // - env.ts refuses to start with DB_SSL=true and no CA, so this is only
  // ever reached with a CA available. rejectUnauthorized stays true: without
  // it the connection would still be encrypted but wouldn't verify the
  // server is actually Aiven, defeating the point of pinning a CA at all.
  ssl: env.DB_SSL ? { ca: loadSslCa(), rejectUnauthorized: true } : undefined,
  // DATE columns (start_date, end_date, ...) come back as plain 'YYYY-MM-DD'
  // strings — not JS Date objects — because every caller (conference forms,
  // <input type="date">, formatDateRange) expects that exact shape, same as
  // the previous backend's DATE type did before this one existed. Returning
  // a Date object here gets JSON-serialized as a full ISO timestamp
  // ("2026-10-11T00:00:00.000Z"), which silently breaks every one of those
  // (e.g. `new Date(`${isoWithTandZ}T00:00:00`)` -> Invalid Date -> a
  // RangeError the moment it's formatted). DATETIME/TIMESTAMP columns are
  // deliberately NOT included here — they stay JS Date objects, which the
  // `timezone: 'Z'` setting below depends on (see its own comment).
  dateStrings: ['DATE'],
  // mysql2's own Date<->DATETIME marshalling is governed by this option, and
  // it defaults to the Node process's LOCAL system timezone — separate from
  // (and not fixed by) the "SET time_zone" session command below. Without
  // this, every Date param we bind (expires_at, locked_until, auth_tokens
  // expiry, ...) gets written/read shifted by the host's local UTC offset,
  // silently corrupting every "is this timestamp past?" comparison.
  timezone: 'Z',
})

// Every connection in the pool must run in UTC: all DATETIME columns are
// stored in UTC and the backend converts to Asia/Kathmandu only when
// displaying (see database/README.md).
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'")
})
