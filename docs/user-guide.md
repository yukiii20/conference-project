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
- **The bell icon** in the top bar of any portal shows your notifications —
  click it to see what's new and mark things read.
- **Your profile**: click your name/avatar → Profile to update your name,
  phone, or photo; Change password to set a new one.

---

## Author

1. **Sign up**: go to the conference's page, click **Submit an abstract** or
   **Sign up**, choose **Author**, and fill in your details. You can't sign
   in until the convenor approves your request — you'll get an email/
   notification when that happens.
2. **Write a submission**: once signed in at `/author`, click **New
   submission**, choose a track, and fill in the title, abstract, and
   keywords. Add co-authors by email — mark one person as the
   "corresponding author" (the one who gets status emails).
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
7. **Register to attend**: on the conference's public page, scroll to
   **Registration**, pick a category, and click **Register to attend**.
   You'll get a registration number and a QR-code ticket — download it or
   just keep the page open to show staff at check-in.
8. **Your certificate**: after the event, once the convenor releases
   certificates, a **Download** link appears next to your certificate on
   the same Registration section of the conference page.

---

## Reviewer

1. **Sign up or get invited**: either sign up choosing **Reviewer** and
   wait for convenor approval, or the convenor invites you directly by
   email (you'll set a password via the link, no approval wait).
2. **See your assignments**: sign in choosing **Reviewer**, land on
   `/reviewer`. Each assignment shows the paper (without the authors'
   names or affiliations, if the conference uses blind review) and a due
   date.
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
2. **Sign in**: choose **Session Chair** at sign-in. You land on
   `/session-chair`, "My sessions" — every session you chair, across every
   conference you're involved with.
3. **Mark attendance**: open a session, and for each presentation click
   **Presented** or **Absent** as it happens.

---

## Staff

1. **Get the role**: the convenor adds you as staff (Members and roles).
2. **Sign in**: choose **Staff** at sign-in. You land on `/staff`, the
   check-in page.
3. **Check people in**: either scan an attendee's ticket QR code with
   **Start camera** (if your browser/device supports it), or type their
   name, email, or registration number into **Manual search** and click
   **Check in**. A big green confirmation (or a clear red reason) shows
   immediately. Someone can only be checked in once per day.
4. **Numbers**: the same page shows how many people are confirmed to
   attend and how many have checked in today.

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
    registration, confirm a pending one, check someone in, and see
    today's numbers.
  - *Certificates* — design a template per certificate type, generate them
    in bulk (or issue a best-paper/speaker one by hand), and release them
    to recipients.
- **Communication and reports**: announcements, email templates, the email
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
- **Conferences**: create a new conference, then appoint an existing user
  as convenor or invite a brand-new person by email (they set their
  password via the link).
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
