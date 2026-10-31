// Single source of truth for the convenor/manager sidebar: which pages exist,
// which tabs each page has, and which tabs a manager can't see (manager holds
// every permission except members.manage and audit.read — see role_permissions
// in database/02_reference_data.sql). Both ConvenorSidebar (picks each page's
// default tab + decides whether to show the page at all) and each page's
// TabbedSection (filters its own tab row) read from this list, so they can
// never drift apart.

/** `keywords` only feed the Ctrl/⌘ K search, so a convenor typing "qr" or "venue" lands on the right tab. */
export type TabConfig = { id: string; label: string; hideForManager?: boolean; keywords?: string[] }
export type SectionConfig = { id: string; label: string; tabs: TabConfig[] }

export const SECTIONS: SectionConfig[] = [
  { id: 'dashboard', label: 'Dashboard', tabs: [] },
  {
    id: 'setup',
    label: 'Conference setup',
    tabs: [
      { id: 'details', label: 'Details', keywords: ['welcome text', 'submission guidelines', 'description', 'contact'] },
      { id: 'branding', label: 'Logo and branding', keywords: ['logo', 'banner', 'colour', 'color'] },
      { id: 'location', label: 'Location', keywords: ['venue', 'map', 'address'] },
      { id: 'supporters', label: 'Supporters', keywords: ['sponsors', 'partners'] },
    ],
  },
  {
    id: 'schedule-basics',
    label: 'Dates and tracks',
    tabs: [
      { id: 'dates', label: 'Key dates', keywords: ['deadlines', 'submission window'] },
      { id: 'tracks', label: 'Tracks', keywords: ['topics', 'themes'] },
    ],
  },
  {
    id: 'people',
    label: 'People',
    tabs: [
      { id: 'requests', label: 'Role requests', hideForManager: true, keywords: ['approve', 'pending'] },
      { id: 'members', label: 'Members and roles', hideForManager: true, keywords: ['roles', 'staff', 'invite', 'session chairs', 'managers'] },
      { id: 'committees', label: 'Committees', keywords: ['organising committee', 'scientific committee'] },
      { id: 'speakers', label: 'Speakers', keywords: ['keynote', 'invited'] },
    ],
  },
  {
    id: 'papers',
    label: 'Papers',
    tabs: [
      { id: 'submissions', label: 'Submissions', keywords: ['abstracts', 'papers', 'authors'] },
      { id: 'reviews', label: 'Reviews and decisions', keywords: ['decisions', 'accept', 'reject', 'review management'] },
      { id: 'auto-assign', label: 'Auto-assign', keywords: ['reviewer assignments', 'assign reviewers'] },
      { id: 'reviewers', label: 'Reviewers', keywords: ['bids', 'bidding', 'workload'] },
      { id: 'settings', label: 'Review settings', keywords: ['review form', 'scoring', 'blind review'] },
    ],
  },
  {
    id: 'event',
    label: 'Event',
    tabs: [
      { id: 'programme', label: 'Programme', keywords: ['schedule', 'sessions', 'rooms', 'time slots', 'timer', 'agenda'] },
      { id: 'attendance', label: 'Attendance', keywords: ['registrations', 'qr', 'check-in', 'name badges', 'print badges'] },
      { id: 'certificates', label: 'Certificates', keywords: ['templates', 'issue'] },
      { id: 'abstracts', label: 'Book of abstracts', keywords: ['abstract book', 'pdf'] },
      { id: 'feedback', label: 'Feedback survey', keywords: ['survey', 'questions'] },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    tabs: [
      { id: 'announcements', label: 'Announcements', keywords: ['news', 'publish'] },
      { id: 'bulk-email', label: 'Bulk email', keywords: ['send email', 'mailing'] },
      { id: 'templates', label: 'Email templates', keywords: ['email templates'] },
      { id: 'emails', label: 'Email log', keywords: ['sent', 'failed', 'delivery'] },
      { id: 'reports', label: 'Reports', keywords: ['export', 'csv', 'download'] },
      { id: 'analytics', label: 'Analytics', keywords: ['charts', 'statistics', 'kpi'] },
      { id: 'activity', label: 'Activity log', hideForManager: true, keywords: ['audit', 'history'] },
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
