// All copy for the public landing page (/) and the legal pages (/privacy,
// /terms) lives here, so wording can be edited without touching components.

export const SITE = {
  name: 'Conference Management System',
  shortName: 'CMS',
  contactEmail: 'conferencemanagment4@gmail.com',
  /** Opens Gmail's web compose (new tab) addressed to the contact email, instead of the OS's default mail app. */
  get contactGmailHref() {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(this.contactEmail)}`
  },

  seo: {
    title: 'Conference Management System — calls for papers, review and programmes',
    description:
      'Run your academic conference in one place: calls for papers, double-blind peer review, programme scheduling and participant management, from first abstract to final session.',
  },

  hero: {
    headline: 'Run your academic conference in one place',
    subheadline:
      'Calls for papers, peer review, programme and participants, from first abstract to final session.',
    primaryCta: 'Browse conferences',
    secondaryCta: 'Submit abstract',
  },

  nav: [
    { id: 'conferences', label: 'Conferences' },
    { id: 'how-it-works', label: 'How it works' },
    { id: 'features', label: 'Features' },
    { id: 'faq', label: 'FAQ' },
    { id: 'contact', label: 'Contact' },
  ],

  conferences: {
    heading: 'Conferences',
    description: 'Browse conferences hosted on this platform.',
    searchPlaceholder: 'Search by name, code or city',
    tabs: [
      { id: 'all', label: 'All' },
      { id: 'open', label: 'Open for abstracts' },
      { id: 'upcoming', label: 'Upcoming' },
      { id: 'past', label: 'Past' },
    ],
    emptyStates: {
      all: 'No conferences are listed yet.',
      open: 'No conferences are open for abstracts right now.',
      upcoming: 'No upcoming conferences right now.',
      past: 'No past conferences yet.',
      search: 'No conferences match your search.',
    },
    loadError: "Couldn't load conferences. Try again.",
    retry: 'Retry',
  },

  announcements: {
    heading: 'Latest announcements',
  },

  steps: {
    heading: 'How it works',
    items: [
      {
        title: 'Create an account',
        description: 'Sign up and choose your role for the conference you want to join.',
      },
      {
        title: 'Submit your abstract',
        description: 'Write or upload your abstract, add co-authors, and submit it for review.',
      },
      {
        title: 'Double-blind peer review',
        description: 'Reviewers assess your work without seeing your name or affiliation.',
      },
      {
        title: 'Present and get your certificate',
        description: 'Once accepted, join the programme and receive your certificate.',
      },
    ],
  },

  roles: {
    heading: 'Built for every role',
    note: "Roles other than author are approved by each conference's convenor.",
    items: [
      {
        title: 'Authors',
        bullets: [
          'Submit and track your abstracts',
          'Add co-authors and manage files',
          'Get decisions and feedback in one place',
        ],
      },
      {
        title: 'Reviewers',
        bullets: [
          'Review assigned submissions double-blind',
          'Score and comment with a simple form',
          'See deadlines for every assignment',
        ],
      },
      {
        title: 'Convenors and organisers',
        bullets: [
          'Manage tracks, dates and branding',
          'Assign reviewers and record decisions',
          'Approve role requests for your conference',
        ],
      },
      {
        title: 'Staff and session chairs',
        bullets: [
          'Help run registration and submissions',
          'Keep the programme and rooms organised',
          'Support presenters on the day',
        ],
      },
    ],
  },

  whyPlatform: {
    heading: 'Why this platform',
    items: [
      {
        title: 'Double-blind review',
        description: 'Reviewers never see author names or affiliations while scoring a submission.',
      },
      {
        title: 'Your data protected',
        description: 'Role-based access and secure storage keep your information to those who need it.',
      },
      {
        title: 'Email updates at every step',
        description: 'Approvals, decisions and assignments are emailed as they happen.',
      },
      {
        title: 'One account for many conferences',
        description: 'Use the same account to take part in any conference hosted on the platform.',
      },
    ],
  },

  faq: {
    heading: 'Frequently asked questions',
    items: [
      {
        q: 'How do I submit an abstract?',
        a: 'Sign up and choose "Author" for the conference you want to submit to. Once the convenor approves your account, go to your Author dashboard, choose "New abstract" and fill in the track, title, abstract and keywords — you can type the abstract, upload a file, or both.',
      },
      {
        q: 'Who can see my paper?',
        a: "Review is double-blind: reviewers see only your submission's content, never your name or affiliation. The convenor of that conference can see full submission details, since they manage the process.",
      },
      {
        q: 'How long does review take?',
        a: "Review timelines are set by each conference's own organisers. Check that conference's Key dates section for the review period and other deadlines.",
      },
      {
        q: 'Can I edit after submitting?',
        a: 'You can edit freely while your submission is a draft. Once you submit it for review, it is locked — you can withdraw it, but only before a decision is made. If a revision is requested, it reopens for editing.',
      },
      {
        q: 'How do I become a reviewer?',
        a: 'Sign up and choose "Reviewer" for the conference, or add the reviewer role to an existing account from your profile flow. The conference\'s convenor reviews and approves every reviewer request before it becomes active.',
      },
      {
        q: 'I forgot my password.',
        a: 'Use the "Forgot password?" link on the sign-in page. We\'ll email you a secure link to set a new one.',
      },
      {
        q: 'How do I organise a conference on this platform?',
        a: "Conferences are set up by our team. Contact us with your conference's details and we'll create it and set you up as the convenor so you can take it from there.",
      },
    ],
  },

  contactBand: {
    heading: 'Organising a conference?',
    description: "Tell us about your conference and we'll get it set up on the platform.",
    cta: 'Contact us',
  },

  footer: {
    description:
      'A platform for running academic conferences — calls for papers, peer review, programme and participants.',
    columns: {
      platform: {
        heading: 'Platform',
        links: [
          { label: 'Conferences', href: '#conferences' },
          { label: 'How it works', href: '#how-it-works' },
          { label: 'FAQ', href: '#faq' },
        ],
      },
      account: {
        heading: 'Account',
        links: [
          { label: 'Sign in', to: '/login' },
          { label: 'Register', to: '/signup' },
          { label: 'Forgotten password', to: '/forgot-password' },
        ],
      },
      legal: {
        heading: 'Legal',
        links: [
          { label: 'Privacy policy', to: '/privacy' },
          { label: 'Terms of use', to: '/terms' },
        ],
      },
    },
    bottomLine: (year: number) => `© ${year} Conference Management System · Banepa, Nepal`,
  },
}

export const LEGAL_LAST_UPDATED = '6 October 2026'
