// 'attendee' is the Audience role (shown as "Audience"; the code predates the label).
export type RoleCode = 'author' | 'reviewer' | 'session_chair' | 'staff' | 'manager' | 'convenor' | 'admin' | 'attendee'

/** The Audience role's code. Self-service: chosen at sign-up it is active at once, with a registration. */
export const AUDIENCE_ROLE = 'attendee' as const

export type RoleDefinition = {
  code: RoleCode
  label: string
  // null for roles with no dashboard yet (nothing to navigate to after login).
  path: string | null
}

// author/reviewer/session_chair/staff all land on the same shared portal
// (its sidebar shows only the sections each visitor's roles unlock) rather
// than a role-specific silo — see src/pages/PortalPage.tsx.
export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  { code: 'admin', label: 'Administrator', path: '/super-admin' },
  { code: 'author', label: 'Author', path: '/portal' },
  { code: 'reviewer', label: 'Reviewer', path: '/portal' },
  { code: 'session_chair', label: 'Session Chair', path: '/portal' },
  { code: 'staff', label: 'Staff', path: '/portal' },
  { code: 'manager', label: 'Manager', path: '/manager' },
  { code: 'convenor', label: 'Convenor', path: '/convenor' },
  { code: 'attendee', label: 'Audience', path: '/portal' },
] as const

// Selectable at signup. role_requests.role_code in the database only allows
// author/reviewer/session_chair/staff/manager (these wait for the convenor's
// approval) — convenor is never self-signed-up, it's appointed directly by a
// platform admin. Audience is listed first: it needs no approval and also
// registers the person, so it's the most common choice.
export const SIGNUP_ROLE_CODES = [
  'attendee',
  'author',
  'reviewer',
  'session_chair',
  'staff',
  'manager',
] as const
export type SignupRoleCode = (typeof SIGNUP_ROLE_CODES)[number]

// Selectable in the login role picker. Administrator is deliberately absent:
// admin sign-in happens only at /super-admin/login, never from this page —
// an admin account signing in here is treated like any other user and only
// gets whatever non-admin roles it separately holds.
export const LOGIN_ROLE_CODES = [
  'author',
  'reviewer',
  'session_chair',
  'staff',
  'manager',
  'convenor',
  'attendee',
] as const
export type LoginRoleCode = (typeof LOGIN_ROLE_CODES)[number]

export function getRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_CATALOGUE.find((role) => role.code === code)
}

export function isSignupRoleCode(code: string): code is SignupRoleCode {
  return (SIGNUP_ROLE_CODES as readonly string[]).includes(code)
}

/** One-line explanation shown under each role on the sign-up picker. */
export const SIGNUP_ROLE_HINTS: Record<SignupRoleCode, string> = {
  attendee: 'Attend the conference. Register now and get your QR ticket at once.',
  author: 'Submit papers. The convenor approves this role.',
  reviewer: 'Review papers. The convenor approves this role.',
  session_chair: 'Chair sessions. The convenor approves this role.',
  staff: 'Help at the registration desk. The convenor approves this role.',
  manager: 'Help run the conference. The convenor approves this role.',
}
