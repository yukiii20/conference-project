// The team behind the platform, shown on /SYPN (the footer's "Project by SYPN" link).
// Optional fields render only when filled in — add a role, a short bio, a photo
// (put it in public/images/team/) or profile links and the page picks them up.

export type TeamLink = { label: string; href: string }

export type TeamMember = {
  id: string
  /** The letter this person gives to "SYPN". */
  letter: string
  fullName: string
  role?: string
  bio?: string
  photo?: string
  email?: string
  links?: TeamLink[]
}

export const TEAM_NAME = 'SYPN'

export const TEAM: TeamMember[] = [
  { id: 'sonika', letter: 'S', fullName: 'Sonika Gautam' },
  { id: 'yuki', letter: 'Y', fullName: 'Yuki Shrestha' },
  { id: 'prashant', letter: 'P', fullName: 'Prashant Sharma' },
  { id: 'nabin', letter: 'N', fullName: 'Nabin Sapkota' },
]
