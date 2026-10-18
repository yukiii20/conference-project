import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://localhost:4100/api'
const PASSWORD = 'Str0ng!Pass1'
const CONFERENCE_SLUG = 'e2e-conf'

// Rotated across VUs so "view /portal" isn't always the same session.
const PORTAL_USERS = [
  { email: 'e2e-author@example.com', role: 'author' },
  { email: 'e2e-reviewer@example.com', role: 'reviewer' },
  { email: 'e2e-manager@example.com', role: 'manager' },
]

export const serverErrors = new Counter('server_errors_5xx')

// After the first successful register/check-in, every later call to those
// two endpoints correctly returns 400/409 ("already registered"/"already
// checked in today") - that's the duplicate-action handling this script
// specifically exercises, not a failure. Without this, k6's default
// http_req_failed metric (anything outside 200-399) would count those
// expected responses as failures and make a passing run look broken.
http.setResponseCallback(http.expectedStatuses(200, 201, 400, 409))

const stageSeconds = __ENV.STAGE_SECONDS ? `${__ENV.STAGE_SECONDS}s` : '30s'
const vusList = (__ENV.VUS_LIST || '10,50,100,200').split(',').map(Number)
const stages = vusList.flatMap((target) => [
  { duration: stageSeconds, target },
  { duration: '1m', target },
])

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages, gracefulRampDown: '10s' },
    portal: { executor: 'ramping-vus', exec: 'portal', startVUs: 0, stages, gracefulRampDown: '10s' },
    register_checkin: {
      executor: 'ramping-vus',
      exec: 'registerAndCheckIn',
      startVUs: 0,
      stages: stages.map((s) => ({ duration: s.duration, target: Math.max(1, Math.round(s.target * 0.1)) })),
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.05'], // 5xx/network only - see note below, 4xx isn't counted as "failed" by k6 by default
    server_errors_5xx: ['count<1'],
  },
}

function noteIfServerError(res) {
  if (res.status >= 500) serverErrors.add(1)
}

function jsonHeaders(cookie) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  return headers
}

function login(email, role) {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email, password: PASSWORD, role }),
    { headers: jsonHeaders() },
  )
  noteIfServerError(res)
  check(res, { 'login ok': (r) => r.status === 200 })
  const setCookie = res.headers['Set-Cookie']
  return setCookie ? setCookie.split(';')[0] : null
}

export function browse() {
  const home = http.get(`${BASE}/conferences/public`)
  noteIfServerError(home)
  check(home, { 'home list 200': (r) => r.status === 200 })

  const detail = http.get(`${BASE}/conferences/${CONFERENCE_SLUG}`)
  noteIfServerError(detail)
  check(detail, { 'conference detail 200': (r) => r.status === 200 })

  sleep(1)
}

export function portal() {
  const user = PORTAL_USERS[__VU % PORTAL_USERS.length]
  const cookie = login(user.email, user.role)
  if (!cookie) return

  const headers = { headers: jsonHeaders(cookie) }
  const me = http.get(`${BASE}/auth/me`, headers)
  noteIfServerError(me)
  check(me, { 'me 200': (r) => r.status === 200 })

  const notifications = http.get(`${BASE}/me/notifications`, headers)
  noteIfServerError(notifications)
  const certificates = http.get(`${BASE}/me/certificates`, headers)
  noteIfServerError(certificates)
  check(notifications, { 'notifications 200': (r) => r.status === 200 })
  check(certificates, { 'certificates 200': (r) => r.status === 200 })

  sleep(1)
}

export function registerAndCheckIn() {
  const authorCookie = login('e2e-author@example.com', 'author')
  if (!authorCookie) return
  const authorHeaders = { headers: jsonHeaders(authorCookie) }

  const conf = http.get(`${BASE}/conferences/${CONFERENCE_SLUG}`, authorHeaders)
  noteIfServerError(conf)
  if (conf.status !== 200) return
  const conferenceId = conf.json('conference.id')

  const categories = http.get(`${BASE}/conferences/${conferenceId}/registration-categories`, authorHeaders)
  noteIfServerError(categories)
  const categoryId = categories.status === 200 ? categories.json('categories.0.id') : null

  if (categoryId) {
    const registerRes = http.post(
      `${BASE}/conferences/${conferenceId}/register`,
      JSON.stringify({ category_id: categoryId }),
      authorHeaders,
    )
    noteIfServerError(registerRes)
    // 201 the first time ever this runs; 400/409 ("already registered") on
    // every later iteration/VU - both are a clean, handled response. A 500
    // here would be the real bug this check exists to catch.
    check(registerRes, { 'register handled, not 500': (r) => r.status < 500 })
  }

  const myReg = http.get(`${BASE}/conferences/${conferenceId}/my-registration`, authorHeaders)
  noteIfServerError(myReg)
  const registrationId = myReg.status === 200 ? myReg.json('id') : null

  if (registrationId) {
    const staffCookie = login('e2e-staff@example.com', 'staff')
    if (staffCookie) {
      const staffHeaders = { headers: jsonHeaders(staffCookie) }
      const checkinRes = http.post(
        `${BASE}/conferences/${conferenceId}/checkin/manual`,
        JSON.stringify({ registration_id: registrationId }),
        staffHeaders,
      )
      noteIfServerError(checkinRes)
      // 200 the first check-in of the day, a clean 400 ("already checked in
      // today") on every later iteration - never a 500.
      check(checkinRes, { 'checkin handled, not 500': (r) => r.status < 500 })
    }
  }

  sleep(1)
}
