# Deploying: Vercel + Render + Aiven (beginner guide)

Three pieces, each hosted separately:

- **Vercel** — serves the built frontend (static files) at
  `https://<name>.vercel.app`. This is the ONLY URL the browser ever talks
  to.
- **Render** — runs the Node backend at `https://<name>.onrender.com`.
  Vercel forwards `/api/*` and `/files/*` to it behind the scenes.
- **Aiven** — hosts the MySQL database. **Already set up** — see
  `docs/aiven-mysql-setup.md` if you need to check what's there; you don't
  need to touch it to deploy.

Why the browser only ever sees the Vercel URL: the session cookie is
`SameSite=Lax`, which only survives if every request looks same-origin to
the browser. Vercel's rewrite makes `yourapp.vercel.app/api/...` forward to
Render *server-side* — the browser never knows Render exists, so the cookie
(and the backend's Origin/CSRF check, `CLIENT_ORIGIN`) keeps working exactly
like local dev, no code change needed for that part.

---

## A. Aiven (already done)

Nothing to do here. You'll need three things from it in step B:

1. **Host, port, user, password, database name** — Aiven console -> your
   service -> **Overview** -> **Connection information**. Use the
   `cms_app` user you created, not `avnadmin`.
2. **The CA certificate** — same page, **Connection information** ->
   download `ca.pem`. Open it in a text editor and copy the whole thing
   (including the `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`
   lines) — you'll paste it into a Render env var in step B.

If anything about the schema/users/triggers looks off, `docs/aiven-mysql-setup.md`
has the full reference (what was run, in what order, and the one gotcha —
a SUPER/binary-logging error on triggers — with its fix).

## B. Render (backend)

1. Push this repo to GitHub if it isn't already there.
2. In the Render dashboard: **New** -> **Blueprint** -> pick this repo.
   Render reads `render.yaml` from the repo root and proposes one web
   service, `conference-cms-backend`. Click through to create it.
   - (No Blueprint / prefer manual setup: **New** -> **Web Service** instead,
     same repo, **Root Directory** = `server`, **Build Command** =
     `npm ci && npm run build`, **Start Command** = `npm run start`,
     **Health Check Path** = `/api/health`.)
3. Set the environment variables (Render dashboard -> your service ->
   **Environment**). `render.yaml` lists which ones exist; these are the
   values:

   | Variable | Value |
   | --- | --- |
   | `DB_HOST` | from Aiven's Connection information |
   | `DB_PORT` | from Aiven (usually not 3306 — Aiven uses a custom port) |
   | `DB_USER` | `cms_app` |
   | `DB_PASSWORD` | the `cms_app` password |
   | `DB_NAME` | `conference_cms` |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | paste the full `ca.pem` text from step A |
   | `SESSION_SECRET` | a new random value — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Don't reuse your local one. |
   | `CLIENT_ORIGIN` | the Vercel URL — you won't have this until step C; put in a placeholder like `https://placeholder.vercel.app` for now and fix it in step C.3 |
   | `APP_URL` | same as `CLIENT_ORIGIN` — also fixed in step C.3 |
   | `TRUST_PROXY` | `1` (already set by `render.yaml`) |
   | `EMAIL_MODE` | `brevo` (see the plan note below) |
   | `BREVO_API_KEY` | from https://app.brevo.com -> SMTP & API -> API Keys |
   | `MAIL_FROM` | an email address verified as a sender in Brevo, e.g. `"Conference CMS <you@yourdomain.com>"` |
   | `STORAGE_DIR` | leave blank unless you're on a paid plan with a disk — see the plan note below |

4. **Plan choice** (Render dashboard -> your service -> **Settings** ->
   **Instance Type**):
   - **Free**: sleeps after 15 minutes idle (the next request takes
     ~30-60s to wake it up), uploaded files (logos, photos, certificates)
     are **deleted on every deploy and restart** because Free has no
     persistent disk, and outbound SMTP ports are blocked (which is why
     `EMAIL_MODE=brevo` above, not `smtp`). Fine for trying this out.
   - **Starter** (or above): always on, and you can attach a **persistent
     disk** (Settings -> **Disks** -> Add Disk, e.g. mount path
     `/var/data/storage`, 1 GB). Set `STORAGE_DIR=/var/data/storage` as an
     env var so uploads survive deploys. SMTP ports are open too, so
     `EMAIL_MODE=smtp` works if you'd rather use Gmail/SMTP than Brevo.
5. Deploy. Once it's live, open **Shell** (top of the service page) and run:
   ```
   npm run create-admin
   ```
   Follow the prompts to create the first super-admin login.
6. Check `https://<your-service>.onrender.com/api/health` returns
   `{"ok":true,...}`.

## C. Vercel (frontend)

1. In the Vercel dashboard: **Add New** -> **Project** -> import this repo.
   Framework Preset: **Vite** (should auto-detect from `vercel.json` /
   `package.json`). Leave build command / output directory as detected
   (`vite build`, `dist`).
2. Before (or right after) the first deploy, edit `vercel.json` in the repo:
   replace both occurrences of
   `https://REPLACE-WITH-RENDER-URL.onrender.com` with your actual Render
   URL from step B (e.g. `https://conference-cms-backend.onrender.com`),
   commit, and push — Vercel redeploys automatically.
3. Copy the resulting Vercel URL (e.g. `https://conference-cms.vercel.app`).
   Go back to Render -> Environment, set:
   - `CLIENT_ORIGIN` = that Vercel URL (no trailing slash)
   - `APP_URL` = the same Vercel URL
   Save -> Render redeploys the backend automatically.

## D. Final checks

Open the Vercel URL in a browser and check, in order:

1. **Login** works (confirms the database connection + SSL).
2. **Upload a logo** (conference settings or platform settings) — confirms
   file uploads work and `/files/public/...` is served correctly through
   the Vercel rewrite.
3. **Redeploy the Render service** (Manual Deploy -> Deploy latest commit),
   then reload the page with the logo. On Free, it will be **gone** (this
   is expected — see plan note in step B.4). On Starter+ with a disk
   attached, it should still be there.
4. **Forgot password**: request a reset for a real inbox you control, check
   the email actually arrives (via Brevo or SMTP, whichever you configured).
5. **QR camera scan** on a phone: open the check-in page over the Vercel
   HTTPS URL (camera access requires HTTPS, which Vercel gives you for
   free) and scan a registration QR code.
6. `https://<your-render-service>.onrender.com/api/health` still returns
   `{"ok":true,...}`.

## E. Updating after this

Both sides auto-deploy from GitHub:

```
git add -A
git commit -m "..."
git push
```

Render rebuilds the backend; Vercel rebuilds the frontend. No manual step
needed on either dashboard unless you changed an env var (see steps B/C
above) or added a new Render disk.

## F. Free-plan limits (and when to upgrade)

| | Free plan limit | Upgrade when... |
| --- | --- | --- |
| **Render** | Sleeps after 15 min idle (slow first request); no persistent disk — **uploaded files vanish on every deploy/restart**; outbound SMTP ports blocked | You need uploads to survive, or always-on response times, or want `EMAIL_MODE=smtp` → **Starter** plan + attach a disk |
| **Vercel** | 100 GB bandwidth/month, generous build minutes — plenty for this app at low traffic | Real production traffic volume → **Pro** plan |
| **Aiven** | 1 GB storage, max 76 connections total, single node (no failover) | Data grows past ~1 GB, or you need high availability → paid Aiven MySQL plan |

For a small/demo deployment, Free-tier Render + Vercel + Aiven is enough to
fully exercise the app end-to-end; the one real gotcha is Render Free's
wiped filesystem, which is why `STORAGE_DIR` + a disk is the first thing to
add when moving past "just trying it out."
