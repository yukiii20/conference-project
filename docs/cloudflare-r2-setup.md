# Cloudflare R2 setup (uploaded files)

**Why:** Render's free plan wipes its disk on every deploy or restart, so uploaded files
(logos, papers, certificates, signatures) disappear. R2 keeps them permanently.

**What stays the same:**
- The database is still Aiven MySQL.
- File URLs (`/files/public/...`) and download links don't change.
- Permission checks on private files are unchanged.

**Cost:** the free tier includes 10 GB of storage, and Cloudflare doesn't charge for
downloads. A conference normally uses far less. Cloudflare may ask for a card to turn R2 on.
Check Cloudflare's R2 pricing page for the current limits.

> Cloudflare's dashboard labels change from time to time. If a button is named slightly
> differently, look for the closest match.

---

## Step 1: Create the bucket (Cloudflare dashboard)

1. Sign in at **dash.cloudflare.com** (a free account is fine).
2. In the left menu, open **R2 Object Storage**. If it asks you to enable R2, accept.
3. Click **Create bucket**.
   - Name: `conference-cms-files` (any name works; you'll need it later)
   - Location: **Automatic**
   - Click **Create bucket**.
4. **Leave the bucket private.** Don't turn on "Public access" or the `r2.dev` URL. The app
   serves the files itself.

## Step 2: Create an API token

1. Back on the **R2 Object Storage** overview page, find **Account ID** on the right and copy
   it.
2. Click **Manage API tokens** (or **API Tokens → Create API token**).
3. Fill in:
   - Name: `conference-cms-backend`
   - Permissions: **Object Read & Write**
   - Specify bucket: **only** `conference-cms-files`
   - TTL: Forever
4. Click **Create**. Copy the **Access Key ID** and **Secret Access Key** straight away. The
   secret is shown **once only**.

You now have 4 values:

| Setting | Where it came from |
|---|---|
| `R2_ACCOUNT_ID` | Account ID (step 2.1) |
| `R2_ACCESS_KEY_ID` | Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key |
| `R2_BUCKET` | `conference-cms-files` |

**Never commit these to git, and never paste them into chat.**

## Step 3: Test on your computer

1. Add the 4 lines to `server/.env` (this file is gitignored). Leave `STORAGE_DRIVER=local`
   for now.
2. In a terminal:
   ```
   cd server
   npm run r2 -- check
   ```
   You should see:
   `Bucket "conference-cms-files": upload... read... delete... OK. R2 is ready.`
   - `AccessDenied`: the token doesn't have Read & Write on this bucket.
   - `NoSuchBucket`: the bucket name doesn't match.
3. Optional: copy your local files into R2:
   ```
   npm run r2 -- upload
   ```
   It's safe to run more than once. Files already in R2 are skipped, and nothing local is
   deleted.
4. Optional: set `STORAGE_DRIVER=r2` in `server/.env`, restart `npm run dev`, upload a logo,
   and check it shows on the site. Then set it back to `local` if you prefer local files while
   developing. **The automated tests always use local storage, whatever `.env` says.**

## Step 4: Turn it on for the live site (Render)

1. Render dashboard → **conference-cms-backend** → **Environment**.
2. Add the 4 `R2_*` variables with the same values.
3. **Then** set `STORAGE_DRIVER` = `r2`.
   Order matters: the server refuses to start if `STORAGE_DRIVER=r2` but any `R2_*` value is
   missing. That's a deliberate safety check.
4. **Save changes.** Render redeploys.
5. Open `https://<your-vercel-site>/api/health`. It should include `"storage":"r2"`.
6. Upload a conference logo on the live site, then trigger **Manual Deploy → Deploy latest
   commit** on Render. After the deploy, the logo must still be there. That proves storage is
   permanent.

## Step 5: Files lost before R2

Files uploaded to the live site **before** this change were stored on Render's disk and
already deleted on an earlier deploy. They can't be recovered. The database still points at
them, so:

- Logos, banners, photos and supporter logos: re-upload them in the app.
- Submission files: the authors need to upload them again. A download now shows "This file is
  no longer available. Please upload it again." instead of an error page.
- Certificates: re-issue them. Background and signature images must be re-uploaded first.

---

## How it works (for developers)

| Part | File |
|---|---|
| Driver interface + local + R2 implementations | `server/src/storage/driver.ts` |
| Save, read and delete helpers (unchanged names) | `server/src/storage/fileStore.ts`, `privateFileStore.ts` |
| Streaming downloads and `/files/public/*` for R2 | `server/src/storage/send.ts` |
| Setting chosen with | `STORAGE_DRIVER` in `server/src/config/env.ts` |
| Check and upload script | `server/src/scripts/r2.ts` (`npm run r2 -- check \| upload`) |
| Tests (no network, S3 mocked) | `server/tests/storage.test.ts` |

- One private bucket holds two prefixes, `public/` and `private/`. The keys are the same
  relative paths saved in the database.
- Downloads are **streamed**, so a 100 MB paper never sits in the server's memory.
- Every key is checked by `assertSafeKey`, which rejects `..`, absolute paths and
  backslashes.
