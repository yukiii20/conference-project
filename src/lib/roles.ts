export type RoleCode = 'author' | 'reviewer' | 'staff' | 'manager' | 'convenor' | 'admin'

export type RoleDefinition = {
  code: RoleCode
  label: string
  path: string
}

export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  { code: 'admin', label: 'Administrator', path: '/super-admin' },
  { code: 'author', label: 'Author', path: '/author' },
  { code: 'reviewer', label: 'Reviewer', path: '/reviewer' },
  { code: 'staff', label: 'Staff', path: '/staff' },
  { code: 'manager', label: 'Manager', path: '/manager' },
  { code: 'convenor', label: 'Convenor', path: '/convenor' },
] as const

// Selectable at signup. Convenor goes through the same pending-approval flow
// as every other role; approving it just requires a platform admin or an
// existing convenor of that conference. Administrator is not here: there is
// no self-service signup for it, accounts are appointed by an admin.
export const SIGNUP_ROLE_CODES = [
  'author',
  'reviewer',
  'staff',
  'manager',
  'convenor',
] as const
export type SignupRoleCode = (typeof SIGNUP_ROLE_CODES)[number]

// Selectable in the login role picker. Administrator is deliberately absent:
// admin sign-in happens only at /super-admin/login, never from this page —
// an admin account signing in here is treated like any other user and only
// gets whatever non-admin roles it separately holds.
export const LOGIN_ROLE_CODES = [
  'author',
  'reviewer',
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
