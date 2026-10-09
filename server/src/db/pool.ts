import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // DATE columns (start_date, end_date, ...) come back as plain 'YYYY-MM-DD'
  // strings — not JS Date objects — because every caller (conference forms,
  // <input type="date">, formatDateRange) expects that exact shape, same as
  // Postgres/Supabase's DATE type did before this backend existed. Returning
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
