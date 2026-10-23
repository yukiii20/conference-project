# User guide

A short, plain-English guide to using the Conference Management System,
one section per role. If you don't see a role you were given, check the
email or notification you received when someone added you — it names your
role.

---

## Everyone

- **Sign in**: go to the site, click **Sign in**, enter your email,
  password, and the role you want to use (the same account can hold more
  than one role). Forgot your password? Click **Forgotten your password?**
  on the sign-in page and follow the email.
- **Your portal**: author, reviewer, session chair, and staff all share one
  portal at `/portal` — a left sidebar (tap **Menu** on a phone), a
  conference switcher if you're involved with more than one, the
  notification bell, and your profile menu, all in the top bar. The sidebar
  only shows the sections your roles unlock — hold two roles (say author
  and reviewer) and you see both sections in the same sidebar, no
  switching portals. Old links like `/author` or `/staff` still work; they
  just forward you into `/portal`.
- **Dashboard**: your roles, upcoming key dates (shown in Kathmandu time),
  and a to-do list — "1 review due in 3 days", "Upload your full paper",
  "Registration is open", and so on. Click any item to jump straight to it.
- **My ticket**: register to attend a conference you're involved with,
  see your registration status, and your QR-code ticket — download it as
  a PNG or show the page itself to staff at check-in. Cancel any time
  before the event.
- **My certificates**: every certificate issued to you, across every
  conference, once the organisers release it (a revoked one still shows,
  marked **Revoked**). **Download PDF** or **Copy verify link** to hand
  someone a link they can check without signing in.
- **The bell icon** in the top bar shows your notifications — click it to
  see what's new and mark things read; **Notifications** in the sidebar
  shows the full list.
- **Your profile**: click your name/avatar → Profile to update your name,
  phone, or photo; Change password to set a new one.

---

## Author

1. **Sign up**: go to the conference's page, click **Submit an abstract** or
   **Sign up**, choose **Author**, and fill in your details. You can't sign
   in until the convenor approves your request — you'll get an email/
   notification when that happens.
2. **Write a submission**: sign in, and in your portal's sidebar open **My
   submissions**. Click **New abstract**, choose a track, and fill in the
   title, abstract, and keywords. Add co-authors by email — mark one
   person as the "corresponding author" (the one who gets status emails).
3. **Submit it**: while it's still open (check the conference's key dates),
   click **Submit**. You'll get a submission code by email. You can edit or
   withdraw a submission before it's reviewed.
4. **Track status**: your submission moves through statuses (submitted →
   under review → accepted/revision requested/rejected). You'll be
   notified at each step.
5. **After acceptance**: upload your full paper (and later, your final
   camera-ready version) from the submission's page.
6. **If you're presenting**: once the convenor schedules your paper into a
   session, your submission page shows the day, time, and room.
7. **Register to attend**: open **My ticket** in your portal, pick a
   category, and click **Register to attend**. You'll get a registration
   number and a QR-code ticket — download it or just keep the page open to
   show staff at check-in.
8. **Your certificate**: after the event, once the convenor releases
   certificates, open **My certificates** in your portal and click
   **Download PDF**.

---

## Reviewer

1. **Sign up or get invited**: either sign up choosing **Reviewer** and
   wait for convenor approval, or the convenor invites you directly by
   email (you'll set a password via the link, no approval wait).
2. **See your assignments**: sign in choosing **Reviewer**, and open **My
   reviews** in your portal's sidebar. Each assignment shows the paper
   (without the authors' names or affiliations, if the conference uses
   blind review) and a due date.
3. **Accept or decline**: if you have a conflict of interest or can't
   review it, decline with a reason. Otherwise accept it.
4. **Write your review**: score the paper on the criteria shown, write
   comments to the author (and, optionally, confidential comments only the
   convenor sees), and pick a recommendation. Save as draft any time;
   **Submit** locks it in.

---

## Session chair

1. **Get the role**: the convenor adds you as a session chair (Members and
   roles) — this role has no public sign-up, you must already be a member.
2. **Sign in**: choose **Session Chair** at sign-in, and open **My
   sessions** in your portal's sidebar — every session you chair, across
   every conference you're involved with.
3. **Mark attendance**: open a session, and for each presentation click
   **Presented** or **Absent** as it happens. If the conference tracks
   session-level attendance, you can also check attendees into your own
   session from the same screen.

---

## Staff

1. **Get the role**: the convenor adds you as staff (Members and roles).
2. **Sign in**: choose **Staff** at sign-in, and open **Check-in desk** in
   your portal's sidebar.
3. **Check people in** — three ways, same result either way. The desk
   remembers which one you used last:
   - **Scan with camera**: point the camera at the ticket's QR code
     (**Start camera** first). If the camera isn't available, the panel
     says so and points you at the other two tabs instead.
   - **Upload QR image**: drag and drop the attendee's QR image onto the
     panel, click **Choose file**, or just paste one (Ctrl+V) — e.g. a
     screenshot of their ticket or a phone photo. It's decoded right there
     in your browser; the image itself is never sent anywhere.
   - **Enter ticket code**: type their name, email, or ticket code (like
     `E2ECONF-R0001` — not case-sensitive, spaces are trimmed) and pick
     them from the list, or press Enter on an exact code.
   Every method shows the same result panel — name, ticket code, category,
   and a big coloured status: green once checked in, amber if they're
   already checked in today (with the time) or still waiting on payment
   confirmation, red if the code doesn't match anyone in this conference or
   their registration was cancelled. Turn on **Verify only** to just look
   someone up (e.g. checking a ticket at the door) without checking them
   in — you still get a **Check in** button if you decide to go ahead.
   Someone can only be checked in once per day.
4. **Numbers**: the same screen shows how many people are confirmed to
   attend and how many have checked in today, next to the check-in card,
   plus a **Recent check-ins** list that updates after every check-in.
   Below that, a read-only **Registrations** list lets you search, filter,
   and export a CSV — you can't see papers, reviews, or any admin settings.

---

## Convenor

You run one conference from end to end. Sign in choosing **Convenor** —
everything lives under `/convenor`, in a left sidebar grouped by area.

- **Dashboard**: at-a-glance counts and a "needs your attention" list
  (unreviewed papers, overdue reviews, deadlines coming up).
- **Conference setup**: name, dates, description, colour/logo/banner,
  venue/location, supporters.
- **Dates and tracks**: every key date (registration, submission, review,
  certificate release, ...) and the paper tracks for this conference.
- **People**:
  - *Role requests* — approve or reject sign-ups.
  - *Members and roles* — see everyone with a role, invite someone
    directly by email (skips the approval step), change or remove roles.
  - *Committees*, *Speakers* — for the public "About" page.
- **Papers**:
  - *Submissions* — see every paper, its status, and its reviews.
  - *Reviews and decisions* — assign reviewers to a paper, then record the
    final accept/reject/revision decision.
  - *Review settings* — review mode (blind or open), how many reviews are
    required, file size/type limits, and the registration/attendance/
    certificate settings described below.
- **Event**:
  - *Programme* — add rooms and (optionally) reusable time slots, create
    sessions, assign chairs, and schedule accepted papers or invited talks
    into them. Toggle List/Grid view; publish a session to make it public.
  - *Attendance* — manage registration categories, see and search every
    registration, confirm a pending one, check someone in (same
    scan/upload/code check-in card the staff desk uses), and see today's
    numbers.
  - *Certificates* — design a template per certificate type, generate them
    in bulk (or issue a best-paper/speaker one by hand), and release them
    to recipients.
- **Communication**: announcements, email templates, the email
  log, exportable reports (CSV/XLSX), and the activity log (who did what).

---

## Manager

Same sidebar and screens as the convenor, under `/manager`, with two
exceptions: you can't approve/manage other people's roles (Members and
roles) and you can't see the activity log. Everything else — programme,
attendance, certificates, submissions, reviews — works exactly the same
way described above.

---

## Platform administrator

Sign in at `/super-admin/login` (a separate login from everyone else).

- **Dashboard**: platform-wide numbers and a system health card (database,
  email queue, disk space).
- **Conferences**: search by name/code/slug or filter by status, see each
  one's submission and registration counts at a glance, open its public
  page or **View as admin** from the row's actions, create a new
  conference, then appoint an existing user as convenor or invite a
  brand-new person by email (they set their password via the link).
- **Users**: search any user, suspend/reactivate/unlock an account, send
  them a password-reset link, or anonymise one that's being deleted
  (removes personal details, keeps the historical record).
- **Admins**: grant or revoke platform-admin access for other users (you
  can't remove the last remaining admin, or yourself).
- **View as admin**: open any conference's convenor portal in a read-only
  mode to see exactly what the convenor sees, without being able to change
  anything.
- **Platform settings**: the site name, support email, and home-page copy
  shown to every visitor.
