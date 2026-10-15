export type RoleCode = 'author' | 'reviewer' | 'session_chair' | 'staff' | 'manager' | 'convenor' | 'admin'

export type RoleDefinition = {
  code: RoleCode
  label: string
  // null for roles with no dashboard yet (nothing to navigate to after login).
  path: string | null
}

export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  { code: 'admin', label: 'Administrator', path: '/super-admin' },
  { code: 'author', label: 'Author', path: '/author' },
  { code: 'reviewer', label: 'Reviewer', path: '/reviewer' },
  { code: 'session_chair', label: 'Session Chair', path: '/session-chair' },
  { code: 'staff', label: 'Staff', path: '/staff' },
  { code: 'manager', label: 'Manager', path: '/manager' },
  { code: 'convenor', label: 'Convenor', path: '/convenor' },
] as const

// Selectable at signup. role_requests.role_code in the database only allows
// author/reviewer/session_chair/staff/manager — convenor is never
// self-signed-up, it's appointed directly by a platform admin.
export const SIGNUP_ROLE_CODES = [
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
] as const
export type LoginRoleCode = (typeof LOGIN_ROLE_CODES)[number]

export function getRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_CATALOGUE.find((role) => role.code === code)
}

export function isSignupRoleCode(code: string): code is SignupRoleCode {
  return (SIGNUP_ROLE_CODES as readonly string[]).includes(code)
}
