# Final release report: production candidate

**Date:** 1 November 2026 (Nepal time) · **Branch:** `release/production-candidate` (from `main` at
`322a372`) · **Status: ready for owner review. Not deployed.**

Nothing in this pass touched production: no deploy, no Aiven SQL, no Render/Vercel environment
change, no production file upload or deletion. Every test below ran on this machine against a
throwaway MySQL 8.0.45 server (port 3316, data in a temp folder) and the `conference_cms_test`
database.

---

## 1. What changed in this pass

The big difference from every earlier phase: **the database-backed tests and the browser tests
had never actually been run since the November rebuild**, because there was no MySQL on the
development machine. This pass installed a private MySQL 8.0.45 (matching Aiven's 8.0 line), ran
everything, and fixed what that exposed.

| # | Change | Kind |
|---|---|---|
| 1 | **Double-blind leak fixed.** Author names survived in Word tracked changes, comments, the people list (including email), headers/footers, custom document properties, and PowerPoint comment-author lists. All are now neutralised on upload. | Security / privacy |
| 2 | **New `GET /api/auth/session`.** Public pages (sign-in, sign-up, registration) asked `/auth/me` and every signed-out visitor got a 401 logged as a red console error. `/auth/session` answers 200 `{user:null}` when signed out; `/auth/me` and all guards are unchanged. | Bug |
| 3 | **Unsaved-changes guard** now uses the app's own dialog instead of the browser-native `confirm()`, and a successful save clears it (Key dates used to ask "Discard changes?" right after saving). The last native dialog (`prompt()` clipboard fallback in My certificates) is now an inline read-only field. | UX |
| 4 | **Accessibility:** form labels are now linked to their inputs everywhere (`FormField` auto-wires `id`, `aria-describedby`, `aria-invalid`; about 50 fields were unlinked). Key-date rows, reviewer bid cards and the section tab strip have accessible names. The registration category picker has a label. `aria-current="page"` on tabs. | Accessibility |
| 5 | **Mobile drawer close button.** On phones the open sidebar covered the header's close button; the drawer now has its own. | UX |
| 6 | **Social sharing image** (`og:image`, `twitter:image`) is now an absolute URL; relative URLs are ignored by Facebook, LinkedIn, WhatsApp and X. | Bug |
| 7 | **Tick workflow committed** at `.github/workflows/tick.yml`; it now goes red when a job fails, and `TICK_URL` is documented as the Render URL (the guide and checklist disagreed). | Ops |
| 8 | **SQL run folder fix:** `database/2026-11-01-part-2/2-AIVEN-run-this.sql` and `3-CHECK.sql` had no `USE conference_cms;`, so on an Aiven connection whose default schema is `defaultdb` they failed with "No database selected". No schema change. | Deployment |
| 9 | **Tests repaired, none weakened:** 6 server tests and about 30 Playwright steps were stale (written before the super-admin role, the error envelope, registration prices, the portal Quick links, the homepage redesign), timezone-dependent (typed the test machine's local time where the app reads Nepal time), or order-dependent (shared seeded data). Each fix keeps or strengthens the original assertion. | Tests |

New tests: `authSession` (4), extra `anonymize` cases (2), `adminUsers` non-admin actor (1),
`src/components/ui/FormField.test.ts` (4).

---

## 2. Test results

| Check | Result |
|---|---|
| TypeScript (frontend + server) | Clean |
| ESLint (frontend + server) | Clean |
| Frontend unit tests (Vitest) | **84 / 84** |
| Server tests (Vitest, real MySQL 8.0.45) | **802 / 802** (66 files; 0 failures, 0 skipped). Before this pass: 788 / 794 on first run |
| Playwright end-to-end (Chromium, seeded test DB) | **117 / 117** (20 specs; 0 flaky). Before this pass: 20+ failing on first run |
| Production builds (`vite build`, server `tsc`) | Succeed |
| Database: fresh install vs upgrade path vs test DB | Identical schema (62 tables, 14 triggers) and identical reference data (108 rows compared by key) |
| Upgrade SQL run twice (idempotency) | No errors; all CHECK rows `OK` |
| Lighthouse, k6 | **Not run** (need the deployed site) |

Largest JavaScript chunks are lazy-loaded only where needed: QR scanner 480 KB (check-in desk),
charts 384 KB (analytics). Main entry 342 KB uncompressed.

---

## 3. Release gate

### GREEN: verified and working

| Area | Evidence |
|---|---|
| Authentication (register, approval, login, logout, forgot/reset, invitation + set password, lockout, expiry, suspended/deactivated) | auth, session, signup, passwordReset, convenorInvite, adminUsers / main.spec, adminPortal.spec |
| Role permissions | roleMatrix (19 endpoints × 7 roles), routeGuards (every route has a guard or a documented public reason) |
| Super admin vs platform admin | superAdmin, adminUsers |
| Conference isolation | conferenceScope, roleMatrix (other conference's convenor 403) |
| Submissions (draft → submit → revision → full paper → camera-ready) | submissions / submissions.spec |
| Double-blind review | reviews, anonymize / reviewBidding.spec |
| Decisions | reviews / submissions.spec |
| Programme (rooms, sessions, clashes, publish, PDF, ICS) | schedule, programme, agendaIcs / programme.spec, agenda.spec |
| Registration, prices, manual payments | registration, registrationFees / registration.spec |
| Check-in (QR image, ticket code, manual, duplicate refused) | checkinMethods.spec, badges.spec |
| Certificates (editor, issue, release, revoke, verify) | certificates, certificatePdf / registration.spec, portal.spec |
| Private file security | storage, submissions (download authorisation, path-escape rejection, 404s) |
| Database integrity | Section 2 schema comparison; triggers enforce clashes, overlaps and the audit log |
| Core responsive experience (320, 375, 390, 768, 1024, 1280, 1440 px) | responsive.spec, usabilityAudit.spec, portal.spec (390 px) in headless Chromium |
| Production build, critical automated tests | Section 2 |

### AMBER: implemented, waiting for the owner

| Item | What's needed |
|---|---|
| **Live database migration** | Run `database/2026-11-01/` then `database/2026-11-01-part-2/` on Aiven (section 5). Until then the live site runs the old schema (the code tolerates it). |
| **Cloudflare R2** (uploads survive deploys) | Bucket + 4 secrets + `STORAGE_DRIVER=r2` on Render, then `npm run r2 -- check`. Until then **every Render deploy wipes uploaded files** (logos, papers, certificate images). |
| **Background jobs while Render sleeps** | `CRON_SECRET` on Render, `TICK_URL` + `CRON_SECRET` GitHub secrets. |
| **Real email delivery** | Never sent through Brevo with the real key in this pass. Send yourself a password reset after deploy. |
| **Brevo delivery/bounce tracking** | `BREVO_WEBHOOK_SECRET` + webhook in Brevo. |
| **Camera check-in on a phone** | Physical test over HTTPS. |
| **Legal pages** | Privacy and Terms are templates; need a lawyer's review. |
| **Lighthouse / k6 on the live site** | Run after deploy. |
| **Super admin appointment** | After part-2 SQL: Super admin → Administrators → *Make super admin*. |

### RED: broken or unsafe

**None found.** One item is close: running without R2 means uploads are lost on every deploy.
That's an owner decision (R2 was deferred), not a code defect, but don't run a real conference
on the live site until R2 is on.

---

## 4. Known limitations

- **Online payment checkout does not exist.** Staff record payments (cash, bank, eSewa, Khalti,
  Fonepay, other). Recording an eSewa/Khalti payment is not a gateway integration.
- **Anonymisation scope:** PDF, DOCX and PPTX are cleaned on upload. Images and legacy
  `.doc`/`.ppt` files are stored unchanged, and so are encrypted PDFs that can't be parsed.
  Names typed into the document body (title page, acknowledgements, self-citations) can't be
  removed automatically; authors must anonymise the text themselves. Files uploaded before this
  release were not re-cleaned (on the current setup they're wiped on deploy anyway).
- **Public conference page caching:** the public conference data is browser-cacheable for 60 s
  (`stale-while-revalidate` 300 s). A convenor who just edited may need a reload or two to see
  the change on the public page; visitors see it within about a minute.
- **View as admin** blocks writes on the server while the view-as header is sent. It protects
  against accidental edits; it is not a permission boundary, because platform admins already
  have write rights.
- **Locations:** one venue per conference.
- **`og:image`** points at `conference-project-eta.vercel.app`. Update `index.html` if you move
  to a custom domain.
- `npm audit` (production dependencies): frontend 0. Server: 9 moderate advisories, all inside
  `exceljs`'s own dependency chain (archiver, glob/minimatch, uuid); none of them receives
  user-controlled input there, and npm's only fix is a major downgrade of `exceljs`.

---

## 5. Deployment instructions (owner, in this order)

Nothing here has been done. Each step needs your approval and your accounts.

1. **Review and merge.** Review this branch, then merge `release/production-candidate` into
   `main`. Pushing `main` triggers both Render and Vercel deploys. The code works on the old
   database, so the order of steps 1 and 2 doesn't matter.
2. **Database** (MySQL Workbench, `docs/DEPLOYMENT_CHECKLIST.md` §1). On your local DB first,
   then Aiven:
   - `database/2026-11-01/2-AIVEN-run-this.sql`, then its `3-CHECK.sql`: every row `OK`.
   - `database/2026-11-01-part-2/2-AIVEN-run-this.sql`, then its `3-CHECK.sql`: `OK`.
   - Never run `01_schema.sql` or `test-setup.sql` against Aiven.
3. **Super admin:** Super admin → Administrators → *Make super admin* for yourself.
4. **R2:** `docs/cloudflare-r2-setup.md`.
5. **Tick:** `docs/DEPLOYMENT_CHECKLIST.md` §3. If the push of `.github/workflows/tick.yml` is
   rejected for missing `workflow` scope, add the file by hand as described there.
6. **Brevo webhook (optional):** `docs/deploy-guide.md` → *Brevo webhook*.

### Environment variables (Render)

Required: `NODE_ENV=production`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`DB_SSL=true`, `DB_SSL_CA` (Aiven CA), `SESSION_SECRET` (32+ random bytes), `CLIENT_ORIGIN` and
`APP_URL` (the Vercel URL), `TRUST_PROXY=1`, `EMAIL_MODE=brevo`, `BREVO_API_KEY`, `MAIL_FROM`.
Optional: `DB_POOL_SIZE` (keep well under Aiven's 76-connection cap), `CRON_SECRET`,
`BREVO_WEBHOOK_SECRET`, `STORAGE_DRIVER=r2` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. All are declared in `render.yaml`.
Vercel needs no variables: `vercel.json` rewrites `/api` and `/files` to Render.

### Rollback

- **Code:** Render → Deploys → previous deploy → *Rollback*; Vercel → Deployments → previous →
  *Promote to production*. Or revert the merge commit on `main`.
- **Database:** nothing to undo. The SQL only adds tables, columns and one role row, which the
  older code ignores.
- **R2:** set `STORAGE_DRIVER` back to `local` (files already in R2 stay there).

### Post-deployment checks

`docs/DEPLOYMENT_CHECKLIST.md` §4, plus:
- [ ] `GET /api/auth/session` while signed out returns `{"user":null,...}` with status 200, and
      the sign-in page shows no red console errors.
- [ ] Upload a DOCX with tracked changes as an author; download it as a reviewer. The file name
      is `S-xxxx-…` and Review → Show markup shows "Author", not the name.
- [ ] Share the home page link in WhatsApp or LinkedIn: the preview image appears.
- [ ] On a phone: open the portal menu, close it with the ✕ inside the drawer.
- [ ] Edit Key dates, save, then click another sidebar item: no "Discard changes?" dialog.
- [ ] Lighthouse on the home page and one conference page.

---

## 6. Reproducing the test run

```
# One-off: MySQL 8.0.x on port 3316, then as root:
#   mysql < database/test-setup.sql
#   CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<test password>';  (grants are in test-setup.sql)
cd server
DB_HOST=127.0.0.1 DB_PORT=3316 DB_USER=cms_app DB_PASSWORD=<test password> \
SESSION_SECRET=<any 32+ chars> CLIENT_ORIGIN=http://localhost:5273 npx vitest run

# End to end: seed, start the throwaway servers, run Playwright
npx tsx tests/e2eSeed.ts
NODE_ENV=test DB_NAME=conference_cms_test STORAGE_ROOT=storage-test-e2e PORT=4100 \
  CLIENT_ORIGIN=http://localhost:5273 npx tsx src/server.ts &
cd .. && VITE_API_PROXY_TARGET=http://localhost:4100 npx vite --port 5273 &
npx playwright test
```

Don't run the server Vitest suite while Playwright is running: both use `conference_cms_test`,
and Vitest resets it.
