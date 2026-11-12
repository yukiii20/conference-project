# File storage setup (Cloudflare R2, or any S3-compatible bucket)

**Why:** Render's free plan wipes its disk on every deploy, restart and wake-up from sleep, so
uploaded files (logos, banners, speaker photos, abstracts, papers, certificates, signatures)
disappear while the database still points at them. That is what caused "pictures only show
for the person who uploaded them" (their browser had cached the picture before it vanished)
and "this file is no longer available". A bucket keeps the files permanently.

**What stays the same:**
- The database is still Aiven MySQL, and no stored path changes (no data migration).
- File URLs (`/files/public/...`) and download links don't change. The backend streams files
  from the bucket.
- Permission checks on private files (abstracts, papers, certificates) are unchanged. The
  bucket stays private and its keys never reach the browser.

**Cost:** Cloudflare R2's free tier includes 10 GB of storage and free downloads. A
conference normally uses far less. Backblaze B2 works the same way (10 GB free).

> Dashboard labels change from time to time. If a button is named slightly differently,
> look for the closest match.

---

## Step 1: Create the bucket (Cloudflare dashboard)

1. Sign in at **dash.cloudflare.com** (a free account is fine).
2. In the left menu, open **R2 Object Storage**. If it asks you to enable R2, accept (it may
   ask for a card even on the free tier).
3. Click **Create bucket**.
   - Name: `conference-cms-files` (any name works; you'll need it later)
   - Location: **Automatic**
   - Click **Create bucket**.
4. **Leave the bucket private.** Don't turn on "Public access" or the `r2.dev` URL. The app
   serves the files itself.

## Step 2: Create an access key

1. On the **R2 Object Storage** overview page, copy the **Account ID** (right-hand side).
2. Click **Manage API tokens** → **Create API token** (the "R2" / "S3" kind, not a general
   Cloudflare API token).
3. Fill in:
   - Name: `conference-cms-backend`
   - Permissions: **Object Read & Write**
   - Specify bucket: **only** `conference-cms-files`
   - TTL: Forever
4. Click **Create**. Copy the **Access Key ID** and **Secret Access Key** straight away. The
   secret is shown **once only**.

You now have these values:

| Setting | Value |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<Account ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `conference-cms-files` |
| `S3_ACCESS_KEY_ID` | Access Key ID |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key |

**Backblaze B2 instead:** create a *private* bucket, then **Application Keys → Add a New
Application Key** limited to that bucket with Read and Write. Use `S3_ENDPOINT` =
`https://s3.<region>.backblazeb2.com` (shown on the bucket page as "Endpoint"),
`S3_REGION` = that region (e.g. `us-west-004`), `S3_ACCESS_KEY_ID` = keyID,
`S3_SECRET_ACCESS_KEY` = applicationKey.

**Never commit these to git, never put them in Vercel or the frontend, and never paste them
into chat.** (The older `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
`R2_BUCKET` settings with `STORAGE_DRIVER=r2` still work, but use the `S3_*` ones for new
setups.)

## Step 3: Test on your computer

1. Add the `S3_*` lines to `server/.env` (gitignored). Leave `STORAGE_DRIVER=local` for now.
2. In a terminal:
   ```
   cd server
   npm run storage-check
   ```
   You should see:
   `Bucket "conference-cms-files": upload... read... delete... OK. The bucket is ready.`
   - `AccessDenied`: the key doesn't have Read & Write on this bucket.
   - `NoSuchBucket`: the bucket name doesn't match.
3. If you still have files on a machine (e.g. an old `server/storage` folder), copy them in.
   **Dry run first**, which lists what would be copied and copies nothing:
   ```
   npm run migrate-storage -- --from D:/path/to/storage
   ```
   Then really copy:
   ```
   npm run migrate-storage -- --from D:/path/to/storage --apply
   ```
   The folder must contain `public/` and/or `private/`. Files already in the bucket are
   skipped (add `--overwrite` to replace them), and nothing local is deleted.
4. Optional: set `STORAGE_DRIVER=s3` in `server/.env`, restart `npm run dev`, upload a logo,
   and check it shows on the site. **The automated tests always use local storage, whatever
   `.env` says.**

## Step 4: Turn it on for the live site (Render)

1. Render dashboard → **conference-cms-backend** → **Environment**.
2. Add `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
3. **Then** set `STORAGE_DRIVER` = `s3`.
   Order matters: the server refuses to start if `STORAGE_DRIVER=s3` but a required value is
   missing. That's a deliberate safety check.
4. **Save changes.** Render redeploys. Wait for "Deploy live".
5. Open `https://<your-vercel-site>/api/health`. It should include `"storage":"s3"`.
   While it still says `"local"`, the Render log shows a large WARNING at startup.
6. Upload a conference logo on the live site, then trigger **Manual Deploy → Deploy latest
   commit** on Render. After the deploy, the logo must still be there, including in a private
   window and on another computer. That proves storage is permanent.

## Step 5: Files lost before the bucket

Files uploaded to the live site **before** this change were stored on Render's disk and were
already deleted on an earlier deploy. They can't be recovered. The database still points at
them, so:

- Logos, banners, photos and supporter logos show a neutral placeholder (first letter or the
  name) instead of a broken image. Re-upload them in the app.
- Submission files: a download now shows "This file is missing from storage. Please ask the
  author to upload it again." The authors need to upload them again.
- Certificates are generated on request, so they keep working. A missing background or
  signature image is simply left out; re-upload it in the certificate template.

---

## How it works (for developers)

| Part | File |
|---|---|
| Driver interface + local + S3 (R2/B2/AWS) implementations | `server/src/storage/driver.ts` |
| Save, read and delete helpers | `server/src/storage/fileStore.ts`, `privateFileStore.ts` |
| Streaming downloads and `/files/public/*` (every driver) | `server/src/storage/send.ts` |
| Settings | `STORAGE_DRIVER`, `S3_*` in `server/src/config/env.ts` |
| Bucket check | `server/src/scripts/r2.ts` (`npm run storage-check`) |
| Copy a local folder into the bucket | `server/scripts/migrate-storage.ts` (`npm run migrate-storage`) |
| Tests (no network, S3 mocked) | `server/tests/storage.test.ts` |

- One private bucket holds two prefixes, `public/` and `private/` - the same layout as the
  local `storage/` folder. Each key is the relative path saved in the database.
- Public files are sent with `Cache-Control: public, max-age=3600` and an ETag (304 when
  unchanged). Never `immutable`: a replaced picture shows everywhere within the hour.
- A missing file is a 404 with `code: "file_missing"`, never cached.
- Downloads are **streamed**, so a large paper never sits in the server's memory.
- Every key is checked by `assertSafeKey`, which rejects `..`, absolute paths and
  backslashes.
- All uploads use multer's memory storage and go through the driver. Nothing in the server
  writes uploads to disk directly.
