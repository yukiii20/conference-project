export type RoleCode = 'author' | 'reviewer' | 'session_chair' | 'staff' | 'manager' | 'convenor'

export type RoleDefinition = {
  code: RoleCode
  label: string
  path: string
}

export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  { code: 'author', label: 'Author', path: '/author' },
  { code: 'reviewer', label: 'Reviewer', path: '/reviewer' },
  { code: 'session_chair', label: 'Session chair', path: '/chair' },
  { code: 'staff', label: 'Staff', path: '/staff' },
  { code: 'manager', label: 'Manager', path: '/manager' },
  { code: 'convenor', label: 'Convenor', path: '/convenor' },
] as const

// Selectable at signup and in the login role picker. Convenor goes through
// the same pending-approval flow as every other role; approving it just
// requires a platform admin or an existing convenor of that conference.
export const SIGNUP_ROLE_CODES = [
  'author',
  'reviewer',
  'session_chair',
  'staff',
  'manager',
  'convenor',
] as const
export type SignupRoleCode = (typeof SIGNUP_ROLE_CODES)[number]

export function getRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_CATALOGUE.find((role) => role.code === code)
}

export function isSignupRoleCode(code: string): code is SignupRoleCode {
  return (SIGNUP_ROLE_CODES as readonly string[]).includes(code)
}
