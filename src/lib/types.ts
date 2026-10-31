/** The `user` object returned by GET /api/auth/me. */
export type MeUser = {
  id: string
  email: string
  full_name: string
  phone: string | null
  institution: string | null
  department: string | null
  position: string | null
  bio: string | null
  country: string | null
  orcid: string | null
  photo_path: string | null
}

export type MyRoleRow = {
  role_code: string
  conference_id: string | null
  conference_code: string | null
  conference_name: string | null
  conference_slug: string | null
  conference_status: string | null
}

/** The conference a sign-in session is bound to (null for a platform-admin session). */
export type SessionConference = {
  id: string
  slug: string
  name: string
  logo_path: string | null
  primary_color: string | null
}

/** One row of the "My conferences" switcher (GET /auth/my-conferences). */
export type MyConferenceEntry = {
  conference_id: string
  slug: string
  name: string
  logo_path: string | null
  primary_color: string | null
  status: string
  /** Active roles — the conference can be opened from the switcher only when this is non-empty. */
  roles: string[]
  /** Roles still waiting for the convenor's approval. */
  pending_roles: string[]
  is_current: boolean
}

export type RoleRequestStatus = 'pending' | 'approved' | 'rejected'

export type MyRoleRequestRow = {
  id: string
  conference_id: string
  conference_code: string | null
  conference_name: string | null
  role_code: string
  status: RoleRequestStatus
  reject_reason: string | null
  created_at: string
}

export type NotificationRow = {
  id: string
  conference_id: string | null
  type: string
  title: string
  body: string | null
  link_path: string | null
  read_at: string | null
  created_at: string
}

export type RoleRequestForReview = {
  id: string
  role_code: string
  status: RoleRequestStatus
  reject_reason: string | null
  applicant_id: string
  applicant_name: string | null
  applicant_email: string | null
  applicant_phone: string | null
  created_at: string
  reviewed_at: string | null
}
