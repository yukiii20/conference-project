# Production checklist: November 2026 reconstruction

Every push to `main` deploys on its own: Render rebuilds the backend and Vercel rebuilds the
frontend. All code merged so far is built to **keep working on the old database** until the SQL
below has been run. Nothing here needs to happen in a hurry, but do it in this order.

Times are Nepal time (Asia/Kathmandu).

---

## 1. Database (owner, in MySQL Workbench)

Run each folder on **your computer first**, then on **Aiven**. Every file is safe to run more than
once, and none of them deletes data.

| Order | Folder | What it adds | Files to run |
|---|---|---|---|
| 1 | `database/2026-11-01/` | My agenda, session timer, book of abstracts, feedback survey, per-conference sign-in | `1-LOCAL-run-this.sql`, then `2-AIVEN-run-this.sql`, then `3-CHECK.sql` on each |
| 2 | `database/2026-11-01-part-2/` | `super_admin` role (one row, no table changes) | same three files |

**Don't run** `batch-3-sql/` or `06_session_conference.sql` separately. They're already inside
folder 1. Never run `01_schema.sql` or `test-setup.sql` against Aiven.

Both folders' files select `conference_cms` themselves (`USE conference_cms;`), so they work
whatever schema your Workbench connection opens on. All of them were run twice in a row on
MySQL 8.0.45 on 1 November: no errors, every CHECK row `OK`.

**After folder 2:**
1. Open Super admin → Administrators.
2. Click **Make super admin** for each person who should manage admins and platform settings.
3. The first time you do this, you're made a super admin too.
4. Until then, every admin keeps full rights.

## 2. Render environment variables (optional, recommended)

Set these in Render → your service → Environment → **Save** (Render redeploys on its own).
Generate each secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Effect when unset | Effect when set |
|---|---|---|
| `CRON_SECRET` (24+ chars) | `/api/internal/tick` answers 404. Jobs run only while the server is awake. | An outside scheduler can wake the server every 10 minutes to send queued email and reminders. |
| `BREVO_WEBHOOK_SECRET` (24+ chars) | `/api/webhooks/brevo` answers 404. Email log stops at "sent". | The email log shows "delivered" and "bounced". Brevo setup is in `deploy-guide.md` → *Brevo webhook*. |
| `R2_*` and `STORAGE_DRIVER=r2` | Uploads stay on Render's disk and are **wiped on every deploy** (free plan). | Uploads persist. Deferred by the owner; see `cloudflare-r2-setup.md`. |

## 3. GitHub tick workflow (only if you set `CRON_SECRET`)

The workflow is committed at `.github/workflows/tick.yml` (copy: `deploy/github-tick-workflow.yml`).

1. If the push of that file was rejected for lack of the `workflow` token scope, add it by hand:
   GitHub → **Add file → Create new file** → `.github/workflows/tick.yml` → paste
   `deploy/github-tick-workflow.yml` → commit.
2. Settings → Secrets and variables → Actions → add two secrets:
   - `TICK_URL` = `https://conference-project-84xj.onrender.com/api/internal/tick` (Render
     directly, not through Vercel: a cold start can take ~1 minute)
   - `CRON_SECRET` = the same value as on Render
3. Actions → **Background jobs tick** → **Run workflow**. It should end green with
   `{"jobs":{"email_recover":"ok",...}}`. A red run means the server was unreachable or a job
   failed (details in the Render logs).

## 4. Checks after deploy

Run these against the live site.

- [ ] `https://<render-service>.onrender.com/api/health` returns `{"ok":true,...}`.
- [ ] The home page loads. Sign in and sign out work.
- [ ] Security headers are present. In DevTools → Network, open the document request; the
      response should have `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
      `Content-Security-Policy` (frame-ancestors) and `Strict-Transport-Security`.
- [ ] QR check-in still opens the camera on a phone. This confirms
      `Permissions-Policy: camera=(self)`.
- [ ] Analytics "today" matches the Nepal date, not the UTC date. Easiest to see between
      00:00 and 05:45 Nepal time.
- [ ] Registration prices: add a price to a category. The registration page shows it, and
      recording a payment for the full amount confirms the registration.
- [ ] Certificates: the preview shows the Nepal issue date.
- [ ] After folder 2 and making yourself super admin: a non-super admin sees platform settings
      as read-only and can't add or remove admins.
- [ ] If `CRON_SECRET` is set: the "Background jobs tick" action on GitHub turns green every
      10 minutes. Render only logs a tick line when a job fails.
- [ ] If `BREVO_WEBHOOK_SECRET` is set: send yourself a test email, and the email log moves to
      "delivered".

## 5. Rolling back

- **Code:** in Render → Deploys, pick an earlier deploy and **Rollback**. In Vercel →
  Deployments, open an earlier one and **Promote to production**.
- **Database:** none of these SQL files needs undoing. Older code ignores the new tables and the
  new role.

## 6. Still open (owner)

- Cloudflare R2 for uploads (deferred).
- Have a lawyer review the privacy and terms pages (they still carry the template notice).
- Delete the old `features-nov` branch on GitHub. It's fully merged.
- To run the ~390 database tests locally, start MySQL 8 and run `database/test-setup.sql`, then
  `cd server && npm test`.
