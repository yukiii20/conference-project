// Single source of truth for the convenor/manager sidebar: which pages exist,
// which tabs each page has, and which tabs a manager can't see (manager holds
// every permission except members.manage and audit.read — see role_permissions
// in database/02_reference_data.sql). Both ConvenorSidebar (picks each page's
// default tab + decides whether to show the page at all) and each page's
// TabbedSection (filters its own tab row) read from this list, so they can
// never drift apart.

export type TabConfig = { id: string; label: string; hideForManager?: boolean }
export type SectionConfig = { id: string; label: string; tabs: TabConfig[] }

export const SECTIONS: SectionConfig[] = [
  { id: 'dashboard', label: 'Dashboard', tabs: [] },
  {
    id: 'setup',
    label: 'Conference setup',
    tabs: [
      { id: 'details', label: 'Details' },
      { id: 'branding', label: 'Logo and branding' },
      { id: 'location', label: 'Location' },
      { id: 'supporters', label: 'Supporters' },
    ],
  },
  {
    id: 'schedule-basics',
    label: 'Dates and tracks',
    tabs: [
      { id: 'dates', label: 'Key dates' },
      { id: 'tracks', label: 'Tracks' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    tabs: [
      { id: 'requests', label: 'Role requests', hideForManager: true },
      { id: 'members', label: 'Members and roles', hideForManager: true },
      { id: 'committees', label: 'Committees' },
      { id: 'speakers', label: 'Speakers' },
    ],
  },
  {
    id: 'papers',
    label: 'Papers',
    tabs: [
      { id: 'submissions', label: 'Submissions' },
      { id: 'reviews', label: 'Reviews and decisions' },
      { id: 'settings', label: 'Review settings' },
    ],
  },
  {
    id: 'event',
    label: 'Event',
    tabs: [
      { id: 'programme', label: 'Programme' },
      { id: 'attendance', label: 'Attendance' },
      { id: 'certificates', label: 'Certificates' },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    tabs: [
      { id: 'announcements', label: 'Announcements' },
      { id: 'bulk-email', label: 'Bulk email' },
      { id: 'templates', label: 'Email templates' },
      { id: 'emails', label: 'Email log' },
      { id: 'reports', label: 'Reports' },
      { id: 'activity', label: 'Activity log', hideForManager: true },
    ],
  },
]

export function visibleTabs(section: SectionConfig, isManager: boolean): TabConfig[] {
  return section.tabs.filter((t) => !(isManager && t.hideForManager))
}

/** Old flat URLs (pre-tab-grouping) mapped to their new `section/tab` path, for redirects. */
export const OLD_PATH_REDIRECTS: Record<string, string> = {
  details: 'setup/details',
  logo: 'setup/branding',
  location: 'setup/location',
  supporters: 'setup/supporters',
  dates: 'schedule-basics/dates',
  tracks: 'schedule-basics/tracks',
  'role-requests': 'people/requests',
  members: 'people/members',
  committees: 'people/committees',
  speakers: 'people/speakers',
  submissions: 'papers/submissions',
  reviews: 'papers/reviews',
  'review-settings': 'papers/settings',
  programme: 'event/programme',
  attendance: 'event/attendance',
  certificates: 'event/certificates',
  announcements: 'communication/announcements',
  'email-templates': 'communication/templates',
  emails: 'communication/emails',
  reports: 'communication/reports',
  'activity-log': 'communication/activity',
}
