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
