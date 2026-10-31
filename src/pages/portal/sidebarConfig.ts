// Single source of truth for the shared portal's sidebar: which sections
// exist, and which roles unlock which section. Unlike the convenor
// sidebar (one fixed list), this one is computed per visitor from the
// roles they actually hold — see visibleSections() below.

export type PortalSectionId =
  | 'dashboard'
  | 'agenda'
  | 'feedback'
  | 'certificates'
  | 'ticket'
  | 'notifications'
  | 'author'
  | 'reviewer'
  | 'session-chair'
  | 'staff'

export type PortalSectionConfig = {
  id: PortalSectionId
  label: string
  /** null = always shown (universal to every signed-in visitor). Otherwise the role_code that unlocks it, for the currently selected conference. */
  requiresRole: string | null
  /** True for sections that aren't scoped to the selected conference (they already span every conference the user is involved in). */
  crossConference?: boolean
}

export const PORTAL_SECTIONS: PortalSectionConfig[] = [
  { id: 'dashboard', label: 'Dashboard', requiresRole: null },
  // Has its own conference picker: attendees with only a registration hold no conference role.
  { id: 'agenda', label: 'My agenda', requiresRole: null, crossConference: true },
  { id: 'author', label: 'My submissions', requiresRole: 'author' },
  { id: 'reviewer', label: 'My reviews', requiresRole: 'reviewer' },
  { id: 'session-chair', label: 'My sessions', requiresRole: 'session_chair', crossConference: true },
  { id: 'staff', label: 'Check-in desk', requiresRole: 'staff' },
  { id: 'ticket', label: 'My ticket', requiresRole: null },
  { id: 'certificates', label: 'My certificates', requiresRole: null, crossConference: true },
  // Has its own conference list: anyone who checked in, chaired or presented, with or without a conference role.
  { id: 'feedback', label: 'Give feedback', requiresRole: null, crossConference: true },
  { id: 'notifications', label: 'Notifications', requiresRole: null, crossConference: true },
]

/**
 * Which sections this visitor should see. Most sections are gated on the
 * roles they hold in the currently *selected* conference; `crossConference`
 * ones (session chair's "My sessions" spans every conference they chair) are
 * gated on holding that role anywhere, regardless of which conference is
 * selected in the switcher.
 */
export function visibleSections(rolesInConference: Set<string>, rolesAnywhere: Set<string>): PortalSectionConfig[] {
  return PORTAL_SECTIONS.filter((s) => {
    if (s.requiresRole === null) return true
    return s.crossConference ? rolesAnywhere.has(s.requiresRole) : rolesInConference.has(s.requiresRole)
  })
}

/** Old single-role portal URLs, kept working as redirects into the shared shell. */
export const OLD_PORTAL_REDIRECTS: Record<string, string> = {
  '/author': '/portal/author',
  '/reviewer': '/portal/reviewer',
  '/staff': '/portal/staff',
  '/session-chair': '/portal/session-chair',
}
