// Auth module. Accounts created here carry the per-backend $RUN marker in their email, so the
// Node and PHP runs never touch each other's rows. Failed sign-ins only ever target those
// accounts (never the shared e2e fixture users, which a lockout would break).
const PASS = 'Str0ng!Pass1'
const conf = { email: 'e2e-convenor@example.com', password: PASS, role: 'convenor', conference: 'e2e-conf' }

export default [
  {
    name: 'convenor sign-in, session, profile, switcher, sign-out',
    steps: [
      { path: '/api/auth/session' },
      { path: '/api/auth/me' },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, remember_me: false }, save: { confId: 'conference.id' }, expectStatus: 200 },
      { path: '/api/auth/me' },
      { path: '/api/auth/session' },
      { path: '/api/auth/my-conferences' },
      { method: 'PATCH', path: '/api/auth/profile', body: { country: 'xx1' } },
      { method: 'PATCH', path: '/api/auth/profile', body: { full_name: 'E2E Convenor', orcid: 'nope' } },
      { method: 'POST', path: '/api/auth/switch-conference', body: { conference_id: '{{confId}}' } },
      { method: 'POST', path: '/api/auth/switch-conference', body: { conference_id: '00000000-0000-4000-8000-000000000000' } },
      { method: 'POST', path: '/api/auth/switch-conference', body: {} },
      { method: 'POST', path: '/api/auth/change-password', body: { current_password: 'wrong', new_password: PASS } },
      { method: 'POST', path: '/api/auth/change-password', body: { current_password: 'x', new_password: 'weak' } },
      { method: 'POST', path: '/api/auth/request-role', body: { requested_role: 'author', conference: 'no-such-conf' } },
      { method: 'POST', path: '/api/auth/logout' },
      { path: '/api/auth/me' },
    ],
  },
  {
    name: 'remember-me cookie and admin sign-in',
    steps: [
      { method: 'POST', path: '/api/auth/login', as: 'r', body: { ...conf, remember_me: true } },
      { path: '/api/auth/session', as: 'r' },
      { method: 'POST', path: '/api/auth/logout', as: 'r' },
      { method: 'POST', path: '/api/auth/admin-login', as: 'a', body: { email: 'e2e-admin@example.com', password: PASS } },
      { path: '/api/auth/me', as: 'a' },
      { path: '/api/auth/my-conferences', as: 'a' },
      { method: 'POST', path: '/api/auth/switch-conference', as: 'a', body: { conference_id: '00000000-0000-4000-8000-000000000000' } },
      { method: 'POST', path: '/api/auth/logout', as: 'a' },
      { method: 'POST', path: '/api/auth/admin-login', body: { email: 'e2e-convenor@example.com', password: PASS } },
    ],
  },
  {
    name: 'sign-in refusals',
    steps: [
      { method: 'POST', path: '/api/auth/login', body: { ...conf, conference: 'no-such-conf' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, role: 'author' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, role: 'attendee' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, email: 'nobody-$RUN@example.com' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, email: 'NOT AN EMAIL' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, role: 'admin' } },
      { method: 'POST', path: '/api/auth/login', body: { ...conf, remember_me: 'yes' } },
    ],
  },
  {
    name: 'sign-up, pending approval, lockout',
    steps: [
      { method: 'POST', path: '/api/auth/login', body: conf, save: { confId: 'conference.id' } },
      { method: 'POST', path: '/api/auth/logout' },
      {
        method: 'POST', path: '/api/auth/register',
        body: { full_name: 'Contract Person', email: 'Signup-$RUN@Example.com', phone: '98-1234 5678', password: PASS, requested_role: 'author', conference_id: '{{confId}}' },
      },
      {
        method: 'POST', path: '/api/auth/register',
        body: { full_name: 'Contract Person', email: 'signup-$RUN@example.com', phone: '9812345678', password: PASS, requested_role: 'author', conference_id: '{{confId}}' },
      },
      { method: 'POST', path: '/api/auth/register', body: { full_name: 'x', email: 'bad', phone: '123', password: 'a', requested_role: 'attendee', conference_id: '{{confId}}' } },
      { method: 'POST', path: '/api/auth/register', body: { full_name: 'Audience Person', email: 'aud-$RUN@example.com', phone: '9812345678', password: PASS, requested_role: 'attendee', conference_id: '{{confId}}' } },
      { method: 'POST', path: '/api/auth/login', body: { email: 'signup-$RUN@example.com', password: PASS, role: 'author', conference: 'e2e-conf' } },
      { method: 'POST', path: '/api/auth/join-conference', body: { email: 'signup-$RUN@example.com', password: PASS, requested_role: 'author', conference: 'e2e-conf' } },
      { method: 'POST', path: '/api/auth/join-conference', body: { email: 'signup-$RUN@example.com', password: PASS, requested_role: 'reviewer', conference: 'e2e-conf' } },
      { method: 'POST', path: '/api/auth/join-conference', body: { email: 'signup-$RUN@example.com', password: 'wrong', requested_role: 'reviewer', conference: 'e2e-conf' } },
      ...Array.from({ length: 5 }, () => ({ method: 'POST', path: '/api/auth/login', body: { email: 'signup-$RUN@example.com', password: 'wrong', role: 'author', conference: 'e2e-conf' } })),
      { method: 'POST', path: '/api/auth/login', body: { email: 'signup-$RUN@example.com', password: PASS, role: 'author', conference: 'e2e-conf' } },
    ],
  },
  {
    name: 'password reset and invitations (public)',
    steps: [
      { method: 'POST', path: '/api/auth/forgot-password', body: { email: 'nobody-$RUN@example.com' } },
      { method: 'POST', path: '/api/auth/forgot-password', body: { email: 'e2e-staff@example.com', conference: 'e2e-conf' } },
      { method: 'POST', path: '/api/auth/forgot-password', body: {} },
      { method: 'POST', path: '/api/auth/reset-password', body: { token: 'not-a-real-token', password: PASS } },
      { method: 'POST', path: '/api/auth/reset-password', body: { token: '', password: 'short' } },
      { method: 'POST', path: '/api/auth/accept-invitation', body: { token: 'not-a-real-token', password: PASS } },
    ],
  },
]
