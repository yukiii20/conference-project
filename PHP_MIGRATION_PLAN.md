# PHP Backend Migration Plan (Phase 0)

Status: **waiting for approval**. Nothing in `server/`, `src/` or `database/` has been changed. No PHP code has been written yet.
Branch: `php-backend` (local only, never pushed).
Inventory made from: `server/src/app.ts`, all `server/src/modules/*/routes.ts`, middleware, jobs, email, storage, config, `database/*.sql`, `e2e/`, `load/`.

---

## 0. Summary and the main surprises

| Item | What the task assumed | What the code actually has |
|---|---|---|
| Endpoints | about 241 | **368** (366 in routers plus `/api/health` and `/files/public/*`); full table in Appendix A |
| Modules | 29 listed | **39 router modules**. Not in your port list: `invitations`, `agenda`, `sessionTimer`, `abstractBook`, `feedback`, `audience`, `publication`, `archive`, `postConference`, `registration/receipts`, `emailWebhooks`, `jobs/tick` (`/api/internal/tick`), platform analytics (`/api/admin/analytics*`) |
| Background jobs | 4 | **5 plus a tick endpoint**: email worker (with stuck-row recovery), session cleanup, announcement publisher, review reminders, **schedule-change emails**. Also `POST /api/internal/tick`, which runs all of them and is called every 10 min by a GitHub Actions workflow because the Render free plan goes to sleep |
| DECIMAL in JSON | "numbers stay numbers" | mysql2 is used **without** `decimalNumbers`, so DECIMAL columns (amounts) and `SUM()`/`AVG()` results reach the frontend as **strings** (`"1500.00"`). Parity means PHP must also return strings there. PDO does this by default, which helps. |
| Server code size | | about 27,000 lines of TypeScript in `modules/`, 1,590 lines of zod schemas (106 object schemas, 77 refine/transform rules), 86 Vitest files, 23 Playwright spec files (73 tests) |
| Local tooling | | **PHP, Composer, Docker and k6 are not installed** on this machine. MySQL 9.7 (scoop) is installed. |

The port is large. A realistic estimate is in §9. The rest of this plan explains how to keep the API contract exact while doing it.

---

## 1. Route inventory

The full table of all 368 endpoints (method, full path, module, auth/permission, other middleware, validation schema, and a hint of the response taken from the handler) is in **Appendix A**. It was generated from the source in mount order, so its row order is the order in which Express tries routes.

Columns:
- **Auth / permission**: `public`, `auth` (requireAuth), `admin`, `super-admin`, `conf-perm: <code>` (requireConferencePermission), `conf-role: [...]`, `machine secret`. `+handler check` means the handler or service also calls `assertConferencePermission` or a similar ownership check after loading the record. Those checks are ported together with the service code, not as middleware.
- **Validation**: `body:<schema>` / `query:<schema>`, defined in the module's `validation.ts`. Each schema is ported 1:1 (see §3, zod).
- **Response**: the first `res.json(...)` / file send found in the handler, plus explicit status codes. This is a hint only. The exact response shapes come from **recorded Node responses** in the contract harness (§6), not from hand-written specs.

Routes per module: registration 41 (29 + 12 receipts), audience 36, schedule 30, admin 26, reviews 21, certificates 20, auth 15, submissions 13, conferences 11, members 10, committees 10, archive 10, feedback 9, bulkEmail 9, me 9, supporters 8, agenda 8, speakers 7, announcements 7, publication 7, abstractBook 6, suggestions 6, analytics 6, tracks 5, sessionTimer 4, emails 4, emailTemplates 4, invitations 3, roleRequests 3, platformSettings 3, badges 3, deadlines 2, settings 2, reports 2, postConference 2, dashboard 1, activityLog 1, webhooks 1, tick 1.

### Mount-order rules that must survive the port
1. `conferencesPublicExtrasRouter` (`/public-deadlines`, `/public-track-count`, `/public-stats`) is mounted before `conferencesRouter` (`/public`, `/:slug`), so the literal paths win over `/:slug`.
2. `GET /api/conferences/:slug` matches **any** single segment that comes after it. Every conference-scoped router uses `/:id/...` with two or more segments, so nothing else is shadowed. `manage.routes` uses `/:id/details` for this reason.
3. Inside routers, literal sub-paths are registered before parameter paths (for example `/:id/sessions/detailed`, `/warnings` and `/chair-candidates` come before `/:id/sessions/:sessionId`, and `/:id/members/invitations` before `/:id/members/:membershipId`). The PHP router keeps the same registration order. In Laravel, the **uncached** route collection matches in registration order, so I will not rely on `route:cache` until a test proves the same order with the cache on.
4. `/api/admin` is shared by four routers (platform analytics, admin, admin emails, platform settings admin, suggestions admin), and `/api` by six (certificate verify, platform settings public, suggestions public, agenda, agenda feed, feedback/me). They are registered in the same order.
5. `/api/calendar/:token.ics`: Express reads `:token` up to the literal `.ics`. The PHP route uses `{token}.ics` with a regex constraint.

### Express behaviours the PHP router must copy (or you decide otherwise, see §10)
- Unknown route: Express's own **HTML** 404 (`<!DOCTYPE html>…<pre>Cannot GET /api/x</pre>`), not JSON.
- Routing is **case-insensitive** and ignores a trailing slash (`/api/auth/me/` works).
- `HEAD` is answered by every `GET` route. `OPTIONS` is answered by CORS preflight (204).
- `req.body` is `{}` unless `Content-Type` is JSON, so validation then returns the normal 400 with `fields`.
- Query strings use `qs` parsing: `a=1&a=2` becomes an array. PHP's `$_GET` keeps only the last value, so the PHP side parses the raw query string itself.
- **Malformed JSON and bodies over 100 kb currently return 500** `"Something went wrong. Please try again."`, because `errorHandler` ignores body-parser's `status`. Strict parity means copying this (see §10, decision 3).

---

## 2. Middleware inventory

Global middleware, in this order (app.ts):

| # | Middleware | Behaviour to reproduce |
|---|---|---|
| 1 | `trust proxy` | `TRUST_PROXY`: `"true"`, `"false"`, a hop count (`"1"` on Render) or a name (`loopback`). Sets `req.ip`, which the rate limiters and `auth_sessions.ip_address` use. PHP: derive the client IP from `X-Forwarded-For` using the same hop logic (Laravel `TrustProxies` with explicit settings). |
| 2 | `helmet` 7.2.0 | Defaults plus `crossOriginResourcePolicy: cross-origin` and CSP `default-src 'none'; img-src 'self'; object-src 'none'; frame-ancestors 'none'` merged with helmet's default directives. **The exact header set will be captured from the running Node server in Phase 1** and copied byte for byte, rather than rebuilt from memory. Also removes `X-Powered-By` (PHP: `expose_php=Off`, and nginx `server_tokens off`). |
| 3 | `cors` | `origin: CLIENT_ORIGIN`, `credentials: true`; preflight 204 with the default methods `GET,HEAD,PUT,PATCH,POST,DELETE` and reflected request headers; `Vary: Origin`. |
| 4 | `compression` | gzip when over 1 kb and the client accepts it. PHP: nginx `gzip on; gzip_min_length 1024; gzip_types application/json …`. |
| 5 | `cookie-parser` | Only reads `cms_session`. |
| 6 | `express.json({limit:'100kb'})` | Size limit and the JSON-only rule (see §1). |
| 7 | `requireMatchingOrigin` | For non-GET/HEAD/OPTIONS: if `Origin` is present and not equal to `CLIENT_ORIGIN`, return 403 `Cross-origin request blocked.`. A missing Origin is allowed. |
| 8 | `blockWritesInAdminViewAsMode` | For non-safe methods: if the `x-admin-view-as` header is present, return 403 `This is a read-only admin view. Sign in as the convenor to make changes.`. |

Per-route middleware:

| Middleware | Behaviour |
|---|---|
| `requireAuth` | Resolves the session (§2a). 401 `You must be signed in.`. If the session is bound to a conference and the URL is `/api/conferences/<uuid>/…` for another conference, 403 `You are signed in to a different conference. Sign in at this conference to continue.` with `code: wrong_conference`. Opens the **session scope** (AsyncLocalStorage); PHP uses a request-scoped `SessionScope` service, which is simpler because PHP handles one request per process. |
| `requireAdmin` | requireAuth, plus admin powers only for an **unbound** (admin-login) session where `isPlatformAdmin` is true. Otherwise 403 `Administrator access required.`. |
| `requireSuperAdmin` | requireAdmin plus `isSuperAdmin`, else 403 `Only a super administrator can do this.`. |
| `requireConferencePermission(code, getId=params.id)` | requireAuth. If there is no conference id: 403 `Could not determine which conference this applies to.`. Then `assertConferencePermission`: session-scope check, admin bypass, then the permission set from `getConferencePermissions`, else 403 `You do not have permission to do this.`. |
| `requireConferenceRole(roles)` | Same pattern, with an active `conference_members.role_code IN (...)`. |
| `refuseWhenConferenceEnded` (3 variants) | After auth and before upload parsing: 409 `code: conference_ended` once the conference has ended (resolved from `:id`, `:sid` or `:aid`). |
| `validateBody` / `validateQuery` | zod `safeParse`. On failure: 400 `{ error: { message: 'Please fix the highlighted fields.', fields: { <first path segment>: <first message> } } }`. On success the **parsed (trimmed, lower-cased, defaulted, unknown-keys-stripped) value replaces the body or query**. |
| multer `.single('file')` | Memory storage, `files: 1`, per-route `fileSize` limit. Oversize: 400 `This file is too large.`; other multer errors: 400 `Could not read the uploaded file.`. |
| `errorHandler` | `AppError`: `{error:{message, fields?, code?}}` with its status. MySQL SQLSTATE 45000: 400 with the trigger's own message (some services map it to 409 first via `mapDatabaseError`). errno 1062: 409 `This already exists.`. errno 3819/4025: 400 `One of the values provided is not valid.`. Anything else: 500 `Something went wrong. Please try again.`. |

### 2a. Sessions and passwords (from `modules/auth/session.ts` and `service.ts`)
- Token: 32 random bytes as hex (64 chars). The DB stores `sha256(token)` hex in `auth_sessions.token_hash`.
- TTL: admin 30 min sliding (`last_seen_at` and `expires_at` pushed forward on every request; past idle, the session is revoked); remember-me 30 days; otherwise 12 h.
- Cookie `cms_session`: `httpOnly`, `sameSite=Lax`, `secure` in production, `path=/`; `Max-Age` only for remember-me (otherwise a browser-session cookie). Logout clears it with `path=/`.
- A non-admin session must be bound to an existing, non-deleted conference, otherwise it is revoked. A user who is not `active` has the session revoked.
- Lockout: 5 failures lead to `locked_until = now + 15 min`; success resets `failed_login_count` and sets `last_login_at`.
- bcrypt cost 12. PHP `password_verify` accepts bcryptjs's `$2a$`/`$2b$` hashes. New PHP hashes are `$2y$`, which I checked bcryptjs 2.4.3 also accepts (`node_modules/bcryptjs/dist/bcrypt.js:1293`), so rolling back to Node stays safe for passwords changed under PHP. Both truncate at 72 bytes.
- Tokens in URLs (`generateUrlSafeToken`): base64url characters, exact length. `random_bytes` plus a base64url encoding gives the same character set and length.

---

## 3. Library mapping (Node to PHP)

| Node | Used for | PHP choice | Parity notes |
|---|---|---|---|
| express, express-rate-limit, helmet, cors, compression, cookie-parser | HTTP stack | Laravel 12 routing and middleware (or Slim 4), custom middleware for each item in §2, nginx gzip | Rate limit headers: express-rate-limit 7.5 `standardHeaders: true` sends `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on 429. Laravel sends `X-RateLimit-*` by default, so I write a small limiter that emits the draft-6 headers. |
| mysql2 | DB | PDO `pdo_mysql`, prepared statements, `ATTR_EMULATE_PREPARES=false`, `ATTR_STRINGIFY_FETCHES=false` | See §6 (JSON parity) for types. `IN (?)` with an array (mysql2 expands it) becomes a helper that generates the right number of placeholders. Never string-built SQL. |
| bcryptjs | passwords | `password_hash`/`password_verify` (cost 12) | See §2a. |
| zod 4.6.7 | validation | **A small zod-compatible schema library written in PHP** (`string()->trim()->min(2,'msg')->email()…`) | 237 fields use zod's **built-in** messages (for example `.max(80)` without a custom message), so errors such as `Too big: expected string to have <=80 characters` must match exactly. Laravel's validator cannot reproduce zod's messages, transforms (trim, lowercase, normalizePhone), defaults, unknown-key stripping or "first message per top-level key". A PHP mirror of the zod API used here (string/number/boolean/enum/array/object/optional/nullable/default/preprocess/refine/superRefine/transform/uuid/email/url/regex) keeps the schemas line-for-line comparable. Each schema gets a test that feeds the same inputs to zod (via a small Node script) and to PHP and compares the messages. |
| nodemailer | SMTP | `symfony/mailer` (SMTP transport; Laravel Mail wraps it) | Same `MAIL_FROM`, host, port and secure settings. `providerMessageId` comes from the Message-ID. |
| fetch to the Brevo API | email | Guzzle / Laravel `Http`, POST `https://api.brevo.com/v3/smtp/email`, 15 s timeout, same JSON body and the same error text `Brevo API error <status>: <body[0..500]>` | |
| pdfkit 0.20 | certificates, programme PDF, abstract book PDF, analytics report PDF, archive/conference report PDF | **TCPDF** (unit `pt`, top-left origin, base-14 core fonts) | pdfkit uses the core Helvetica/Times fonts, and TCPDF ships the same Adobe font metrics, so text widths, line wrapping and positions can match. Only WinAnsi characters work in core fonts in both. Pixel-level identity is not realistic, so the target is a side-by-side visual check (I will render both versions to PNG with poppler `pdftoppm`, which is installed, and show you an overlay/diff). |
| pdf-lib | removing PDF author metadata (anonymised review copies) | **`qpdf` binary** in the Docker image (`--remove-info --remove-metadata`), called with escaped arguments | Free FPDI cannot read PDFs with compressed object streams (most modern PDFs), so it is not a safe choice. Locally on Windows: `scoop install qpdf`. |
| jszip | removing DOCX `docProps/core.xml`/`app.xml` author fields | `ZipArchive` (ext-zip) and DOMDocument | |
| exceljs | xlsx exports (reports, analytics, feedback results, badges, audience) | PhpSpreadsheet | Same sheet names, column order, headers, widths, number formats and file names. Contract tests compare **cell values** after opening the file, because the bytes will differ (zip timestamps, styles.xml). |
| CSV (`utils/csv.ts`) | CSV exports | Native port of `csvCell`/`csvRow`: every cell quoted, formula-injection `'` prefix, Date as an ISO string, the same line endings and BOM handling as each Node route | Byte-identical CSV is the target. |
| qrcode | ticket QR PNG, certificate QR | `chillerlan/php-qrcode` (same error-correction level and margin) | The PNG bytes will differ. The decoded content and the image size can be made equal, and the test decodes both. |
| sharp | image re-encode, EXIF rotate, square photo crop | **Imagick** (ext-imagick): `autoOrient`, `cropThumbnailImage`, PNG/WebP/JPEG q90 | sharp's `position: 'attention'` (saliency crop) has no PHP equivalent. I propose a centre crop, which gives the same dimensions but possibly a slightly different framing (decision 5). Output bytes will differ, and only dimensions and format are compared. |
| file-type | content-based MIME sniffing | Port of the few magic-byte signatures actually used (PNG/JPEG/WEBP/PDF/ZIP-based DOCX/PPTX, etc., from `submissions/fileRules.ts`, `audience/materials.ts`, `receipts.ts`) | `finfo` reports DOCX inconsistently (`application/zip` or `octet-stream`), so a direct signature port gives exact parity. `finfo` is kept as a second check. |
| sanitize-html | email template HTML (allow-list `p br strong em a ul ol li h2 h3`, `a[href]`, schemes http/https/mailto, `discard`); strip-all for platform settings and suggestions | `symfony/html-sanitizer` with the same allow-list; strip-all via a DOM text walk | Entity encoding of the output can differ slightly (for example `&amp;`). Contract tests cover saved templates; any difference is listed in the parity report. |
| multer | multipart | PHP's native `$_FILES` / Laravel `UploadedFile`, with per-route size checks producing the same messages | `upload_max_filesize = 26M`, `post_max_size = 27M` (the biggest route limit is 25 MB). PHP rejects an over-limit upload before the route runs, so a middleware turns `UPLOAD_ERR_INI_SIZE` into the same 400 `This file is too large.`. |
| @aws-sdk/client-s3 | S3/R2 storage driver | `league/flysystem-aws-s3-v3` behind the same `StorageDriver` interface (`put/get/open/exists/delete`, `public`/`private` areas, `assertSafeKey`) | The same keys and paths are stored in the DB, so switching drivers never changes a URL. |
| setInterval timers | jobs | Laravel scheduler (`schedule:work` or cron `schedule:run`) and the tick endpoint | See §4. |
| dotenv and the zod env schema | config | `vlucas/phpdotenv` and a ported env validation with the **same refusal rules** (weak secret in production, https checks, SMTP/Brevo/S3/SSL completeness) | |
| node:crypto | tokens, sha256, timingSafeEqual, randomUUID | `random_bytes`, `hash('sha256')`, `hash_equals`, `ramsey/uuid` (v4) | |
| Intl.DateTimeFormat (18 call sites: ICS, PDFs, emails) | Asia/Kathmandu display | `IntlDateFormatter` (ext-intl) and `DateTimeZone('Asia/Kathmandu')` | ICU versions can differ in small details (comma placement, "Sept" vs "Sep"). Each formatter gets a test fixed against Node's output. `utils/timezone.ts` (`zonedWallTimeToUtc`, `localDateRangeToUtc`, `weekStartKey`, …) is ported with the same tests. |

---

## 4. Background work

| Job | Node timing | What it does | PHP |
|---|---|---|---|
| Email worker | every 10 s; recover stuck rows at start and every 5 min | `SELECT … FOR UPDATE SKIP LOCKED` batch of 20 queued rows, or failed rows with `attempts < 5` and back-off `2^attempts` minutes; mark `sending`; render template; send; then `sent` with `provider_message_id` and redacted `template_data`, or `failed` and `attempts+1`. Rows stuck in `sending` for more than 10 min go back to `queued`. | `php artisan emails:work` long-running loop (sleep 10 s), plus scheduled `emails:recover` every 5 min. The same SQL, so it is safe with two workers (SKIP LOCKED). |
| `sendQueuedEmailNow` (inline send for invites/tests) | send with an 8 s race; the response may say `queued` while sending continues | | PHP cannot keep sending after it responds in the same way. Proposal: call the provider with a hard 8 s timeout; on timeout, put the row back to `queued` (the worker retries) and return `queued`. Same API result; the difference is that a slow send is retried by the worker instead of finishing in the background (decision 7). |
| Session cleanup | at start, then daily | delete expired/revoked `auth_sessions`, used/expired `auth_tokens` | scheduler `daily()` plus `onOneServer` is not needed because the deletes are idempotent |
| Announcement publisher | every 60 s | `publishDueAnnouncements` | scheduler `everyMinute()->withoutOverlapping()` |
| Review reminders | hourly | `sendDueReminders` (INSERT IGNORE / FOR UPDATE claims) | scheduler `hourly()` |
| Schedule-change emails | every 5 min | `sendScheduleChangeEmails` | scheduler `everyFiveMinutes()` |
| `POST /api/internal/tick` | external cron every 10 min (GitHub Actions) | runs all six steps in order; Bearer `CRON_SECRET` (timing-safe); 404 if unset, 401 if wrong, 202 if a tick is already running | Same endpoint and responses. "Already running" uses an atomic cache lock instead of an in-memory flag, which is more correct with several PHP-FPM workers. |

Hosting needs: one container running **nginx + PHP-FPM + `schedule:work` + `emails:work`** under supervisord (or s6). On the Render free plan the container sleeps, so the existing tick workflow stays the safety net, as it is today. On a VPS: systemd units or supervisord, plus `* * * * * php artisan schedule:run`. On shared hosting: cron `schedule:run` every minute, and the email worker runs as a scheduled `emails:work --once`.

---

## 5. Environment variables

The same names as the Node backend, so the Render dashboard values carry over. Proposed `backend-php/.env.example` (created in Phase 1; no secrets):

```dotenv
# --- App ---
APP_ENV=development            # development | test | production   (replaces NODE_ENV; NODE_ENV is also read for compatibility)
PORT=4000                      # only used by the local dev server (php -S / artisan serve)
CLIENT_ORIGIN=http://localhost:5173
APP_URL=http://localhost:5173  # base for links in emails
TRUST_PROXY=                   # "1" on Render; empty locally
SESSION_SECRET=                # 32+ random chars in production (startup refuses weak values)
LOG_LEVEL=info

# --- Database (same as server/.env) ---
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=cms_app
DB_PASSWORD=
DB_NAME=conference_cms
DB_POOL_SIZE=20                # accepted for compatibility; PHP-FPM uses one connection per worker
DB_SSL=false
DB_SSL_CA=
DB_SSL_CA_PATH=

# --- Email ---
EMAIL_MODE=console             # console | smtp | brevo
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
BREVO_API_KEY=
BREVO_WEBHOOK_SECRET=          # 24+ chars; empty = webhook off
CRON_SECRET=                   # 24+ chars; empty = /api/internal/tick returns 404

# --- Storage ---
STORAGE_DRIVER=local           # local | s3 | r2
STORAGE_DIR=                   # default: backend-php/storage (Node used server/storage; point both at the same folder for cut-over)
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# --- Rate limiting (PHP only) ---
RATE_LIMIT_STORE=apcu          # apcu | file
```

The Laravel-specific `APP_KEY` is only needed if Laravel's encrypter is used (it will not be: sessions are our own). If Laravel is chosen it will be generated but not used for anything in the contract.

---

## 6. Risks and the hard parts

1. **JSON parity (highest risk, touches every endpoint).**
   - DATETIME(3): mysql2 returns `Date`, so the JSON is `2026-11-23T04:15:00.000Z` (always 3 decimals, `Z`). PHP converts every DATETIME/TIMESTAMP column to this format. DATE stays `YYYY-MM-DD` (`dateStrings: ['DATE']`). TIME stays a string.
   - Column types come from `PDOStatement::getColumnMeta()` (native type). MySQL **JSON columns and JSON_OBJECT/JSON_ARRAYAGG expressions** are parsed into objects by mysql2. PHP must do the same. I will verify in Phase 1 that `getColumnMeta` reports the JSON type through mysqlnd; if it does not, a per-query cast list is the fallback.
   - Integers (INT, BIGINT, COUNT) come back as numbers, TINYINT(1) as 0/1, DECIMAL/SUM/AVG as **strings**, DOUBLE/FLOAT as numbers.
   - Encoding: `JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`. Floats with no fraction must print as `5`, not `5.0`. **Empty PHP arrays are ambiguous** (`[]` vs `{}`): every place that returns an object map (for example `fields`, `template_data`, `layout`, permission maps) uses explicit `stdClass`/`ArrayObject`. The contract tests catch any slip.
   - JS `undefined` keys are dropped by `JSON.stringify`, so PHP must drop them too, not output `null`.
2. **`withTransaction` and `@app_user_id`.** There are 194 transaction call sites. The triggers and audit tables read `@app_user_id`, so the PHP helper is the only way to open a transaction: `BEGIN`, `SET @app_user_id = ?`, callback, `COMMIT`/`ROLLBACK`. Because PHP-FPM reuses a persistent connection only if configured to, I will use non-persistent connections, and the helper also resets `@app_user_id = NULL` after commit so a later non-transaction query never inherits a stale actor. Each connection also runs `SET time_zone = '+00:00'` on connect.
3. **Locking.** 75 `SELECT … FOR UPDATE` (some with `SKIP LOCKED`). This is the same SQL on the same connection inside the transaction, so it ports directly. There are concurrency tests for registration capacity, certificate numbers and email claims.
4. **Session scope.** AsyncLocalStorage becomes a request-scoped object. It needs care in the CLI jobs, which must run unbound exactly as in Node.
5. **Validation messages** (see zod row in §3): 237 fields with zod default messages, plus custom `refine`/`superRefine` logic.
6. **Multipart uploads**: PHP rejects over-size uploads before the app sees them (see §3), and a request over `post_max_size` arrives with an empty body. Both cases must still give the Node messages.
7. **Streaming downloads**: `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Length`. Public files: `Cache-Control: public, max-age=3600`, ETag/Last-Modified, 304 on `If-None-Match`, HEAD support, and the 404 JSON `This image is missing from storage…` with `code: file_missing`.
8. **Certificate and PDF layout parity**: see §3 (TCPDF). This is the most visible difference. You will get side-by-side PNGs of every certificate type and of the programme PDF.
9. **Excel parity**: values and layout match; bytes do not.
10. **Time zones**: ICU formatting differences (see §3). Deadline windows use `localDateRangeToUtc`, which is ported with identical tests, including the date-line edge cases already covered in `e2e/nepalTime.ts`.
11. **Rate limits**: express-rate-limit uses an in-memory store per Node process. The PHP equivalent needs a store shared between FPM workers: **APCu** (per container, same behaviour as one Node process) or the file cache. The DB is not an option without a new table, and a schema change is not planned.
12. **Inline email sending with an 8 s timeout**: see §4.
13. **Image crop**: sharp `attention` vs a centre crop (see §3).
14. **Node's 500 on malformed JSON / oversize body**, HTML 404, case-insensitive routes: copy the quirks or fix them (decision 3).
15. **Performance**: PHP-FPM runs one request per worker. Long PDF or Excel generation holds a worker, so `pm.max_children` must be sized (and the DB pool limit, `DB_POOL_SIZE`, behaves as "max connections = FPM workers"). The Aiven free plan caps the whole service at 76 connections, so `pm.max_children` ≤ 20.
16. **Schema changes**: none expected. If one turns out to be unavoidable I will stop and show you the SQL first.

---

## 7. Test and parity strategy

- **Test database:** only `conference_cms_test` (from `database/test-setup.sql`) and `server/tests/e2eSeed.ts`. Never `conference_cms`. The PHP DB layer refuses to start tests unless `SELECT DATABASE()` is `conference_cms_test`, the same guard the seed uses.
- **Contract harness** (`backend-php/tests/contract/`, a Node script so it can reuse the seed): for each scenario (a list of requests with cookies):
  1. reset the DB (fast restore of a mysqldump snapshot taken right after the seed) and the storage-test folder,
  2. run it against Node (port 4100),
  3. reset again and run it against PHP (port 4200),
  4. normalise (generated UUIDs mapped by first appearance, timestamps within ±5 s, random tokens, the `Date` header, `uptime_seconds`) and diff status, headers that matter (Content-Type, Content-Disposition, Set-Cookie attributes, cache headers, RateLimit-*) and bodies. Files are compared by type: CSV byte-exact, xlsx by cell values, PDF by extracted text plus a rendered image, PNG by dimensions and decoded QR content.
  5. compare the **DB state** after write scenarios (row diff of the touched tables, including `audit_logs` and the trigger-written history tables). This is what proves `@app_user_id` is set.
- **PHPUnit feature tests per module**, ported from the matching Vitest file in `server/tests/` where one exists (86 files).
- **Playwright**: run unchanged with the PHP backend on 4100 (or with `VITE_API_PROXY_TARGET` pointing at it). No change to the test files.
- **k6**: `load/scenario.js` against Node and then PHP on the same machine and DB, with median and p95 reported for both. There are no earlier Node numbers in the repo, so both get measured fresh.
- `PARITY_REPORT.md`: endpoint, ported, contract test pass/fail, notes.

---

## 8. Port order

Infrastructure first, then your order, with the missing modules placed next to their dependencies:

| Step | Contents | Endpoints |
|---|---|---|
| Phase 1 | skeleton, config, DB and transaction helper, JSON serializer, error handler, sessions, permissions, rate limiters, CORS, origin and view-as guards, security headers, `/api/health`, `/files/public/*`, storage driver, logging, Dockerfile, nginx, supervisord, contract harness | 2 |
| 2 | health check (done in Phase 1), **auth**, **invitations** | 18 |
| 3 | me, platformSettings | 12 |
| 4 | conferences (public, public extras, manage including logo/banner) | 11 |
| 5 | roleRequests, members, tracks, deadlines, settings | 22 |
| 6 | committees, speakers, supporters | 25 |
| 7 | submissions (including file rules and anonymisation) | 13 |
| 8 | reviews (including bids and reminders) | 21 |
| 9 | schedule (including programme PDF and ICS), sessionTimer, agenda | 42 |
| 10 | registration and receipts (including QR tickets) | 41 |
| 11 | badges, certificates | 23 |
| 12 | announcements, emails, emailTemplates, bulkEmail, emailWebhooks, the email worker and all jobs, tick | 26 |
| 13 | audience, feedback, abstractBook, publication | 58 |
| 14 | reports, analytics (conference and platform), activityLog, dashboard | 10 |
| 15 | archive, postConference | 12 |
| 16 | admin, suggestions | 32 |
| 17 | full Playwright run, k6, certificate/PDF visual comparison, DEPLOY_PHP.md, final report | |

A commit after each step, on `php-backend` only. No pushes.

### Hosting options
| Option | Fit | Notes |
|---|---|---|
| **Docker on Render (recommended)** | The same platform, env vars and tick workflow as today | `php:8.3-fpm` + nginx + supervisord in one image; health check `/api/health`. The free plan has no persistent disk (the R2 limitation you already know about is unchanged). |
| VPS (Ubuntu + nginx + PHP-FPM 8.3) | Most control; real cron and workers | systemd/supervisord units are included in DEPLOY_PHP.md. |
| Shared hosting (cPanel) | Possible but weakest | Needs PHP 8.3 with imagick, intl, zip and `proc_open` for qpdf, which many hosts do not allow. No long-running worker, so cron runs `schedule:run` every minute. |

Required PHP 8.3 extensions: `pdo_mysql`, `mbstring`, `intl`, `fileinfo`, `imagick` (or `gd` as a weaker fallback), `zip`, `xml`/`dom`, `openssl`, `curl`, `apcu`, `bcmath` (exact DECIMAL arithmetic where the services do money sums), `sodium`. System packages: `qpdf`; `poppler-utils` for tests only.

---

## 9. Effort estimate

Shown as focused working days, the way a developer would plan it. I work through it in sessions, and the contract tests decide when a step is done, not the calendar.

| Phase | Estimate |
|---|---|
| Phase 1: foundation, harness, Docker | 4–5 days |
| Steps 2–6: auth through supporters (88 endpoints) | 7–9 days |
| Steps 7–8: submissions and reviews | 5–6 days |
| Steps 9–11: schedule, registration, certificates (PDF/QR work) | 9–11 days |
| Steps 12–13: email system, jobs, audience/feedback/abstract book/publication | 8–10 days |
| Steps 14–16: reports, analytics (xlsx/PDF), archive, admin | 5–7 days |
| Step 17: full e2e, load test, visual comparison, docs | 3–4 days |
| **Total** | **about 41–52 days** |

---

## 10. Decisions I need from you

1. **Framework.** I recommend **Laravel 12, used thinly**: its router, middleware, container, config, console/scheduler, Flysystem storage, mailer, HTTP client and PHPUnit helpers. It would *not* use Eloquent, its session/auth, its validator or migrations, because each would break the contract.
   **Slim 4 + PHP-DI** is the "closer to core PHP" option. Trade-offs:
   - Slim: about 15 small packages instead of a framework; a structure that reads like the Express app (one router file per module, middleware per route), so it is easier for a supervisor to read line by line; no hidden behaviour to switch off. Cost: I write the console runner and scheduler, config loading, the test HTTP client and the storage wiring myself, about 3–4 extra days.
   - Laravel: faster to build and more familiar to most PHP reviewers, with a good scheduler and test tooling. Cost: a larger codebase, and more defaults to disable (sessions, CSRF, cookie encryption, `X-RateLimit` headers, trailing-slash redirects).
   Either way the business code (services and SQL) looks the same.
2. **Scope:** confirm that all **368** endpoints and the 13 extra modules are in scope.
3. **Copy Node's quirks or fix them?** Malformed JSON or >100 kb body gives 500; unknown routes give an HTML 404; case-insensitive and trailing-slash routes. I recommend **copying them** for the contract, listing them in PARITY_REPORT.md, and fixing them later in both backends if you want.
4. **Local tools:** may I install, through scoop, **PHP 8.3** (`versions/php83`) with the extensions above, **Composer**, **k6** and **qpdf**? Docker Desktop is optional (it is needed to test the image locally; without it I build and test the image only through Render).
5. **Image crop:** accept a centre crop instead of sharp's `attention` crop for square photos.
6. **PDF metadata stripping:** accept `qpdf` as a required system binary.
7. **Inline email with an 8 s timeout:** accept the "time out, back to queued, worker retries" behaviour (§4).
8. **Rate-limit store:** APCu (recommended; per container, like one Node process) or the file cache.
9. **Hosting target for DEPLOY_PHP.md:** Docker on Render (recommended), VPS, or shared hosting.
10. **Port for the PHP test backend:** run it on **4200** next to Node on 4100 for contract tests, and point the Playwright stack at it through `VITE_API_PROXY_TARGET` (no test edits). OK?

---

## Appendix A: Endpoint inventory (368)

Two endpoints are defined directly in `app.ts`:

| # | Method | Path | Module | Auth / permission | Other middleware | Validation | Response |
|---|---|---|---|---|---|---|---|
| A1 | GET, HEAD | `/files/public/*` | storage/send | public | (global only) | `assertSafeKey` | stream with ETag/Last-Modified/Cache-Control; 304; 404 JSON `file_missing` |
| A2 | GET | `/api/health` | app | public | | | json `{ ok, uptime_seconds, database, email_queue, storage }` [200/503] |

Router endpoints in mount order (generated from the source):

| # | Method | Path | Module | Auth / permission | Other middleware | Validation (schema) | Response (from handler) |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/webhooks/brevo` | emailWebhooks/routes | machine secret | machineEndpointRateLimit |  | json { message: 'Not found.' } [404,401] |
| 2 | POST | `/api/internal/tick` | jobs/tick | machine secret | machineEndpointRateLimit |  | json { message: 'Not found.' } [404,401,202] |
| 3 | POST | `/api/auth/register` | auth/routes | public | authRateLimit | body:registerSchema | json { message: "Account created. The conference's convenor must approve it [201] |
| 4 | POST | `/api/auth/join-conference` | auth/routes | public | authRateLimit | body:joinConferenceSchema | json { signed_in: false, message: 'Request sent. You can sign in at ${confe [201] |
| 5 | POST | `/api/auth/login` | auth/routes | public | authRateLimit | body:loginSchema | json { user: profile, roles, conference: sessionConferenceDto(conference) } |
| 6 | POST | `/api/auth/admin-login` | auth/routes | public | authRateLimit | body:adminLoginSchema | json { user: profile, roles, conference: null } |
| 7 | POST | `/api/auth/logout` | auth/routes | public |  |  | json { message: 'Signed out.', conference_slug: conferenceSlug } |
| 8 | GET | `/api/auth/me` | auth/routes | auth |  |  | json await meResponse(req.user!) |
| 9 | GET | `/api/auth/session` | auth/routes | public |  |  | json { user: null, roles: [], isAdmin: false, isSuperAdmin: false, conferen |
| 10 | GET | `/api/auth/my-conferences` | auth/routes | auth |  |  | json { current_conference_id: req.user!.conferenceId, conferences: conferen |
| 11 | POST | `/api/auth/switch-conference` | auth/routes | auth +handler check |  | body:switchConferenceSchema | json { user: profile, roles: rolesRows, conference: sessionConferenceDto(co |
| 12 | POST | `/api/auth/request-role` | auth/routes | auth | authRateLimit | body:requestRoleSchema | json { message: 'You are registered for ${conference.name}. Switch to it to [201] |
| 13 | PATCH | `/api/auth/profile` | auth/routes | auth |  | body:updateProfileSchema | json { user: profile } |
| 14 | POST | `/api/auth/change-password` | auth/routes | auth |  | body:changePasswordSchema | json { message: 'Password updated.' } |
| 15 | POST | `/api/auth/forgot-password` | auth/routes | public | forgotPasswordIpLimit, forgotPasswordEmailLimit | body:forgotPasswordSchema | json { message: "If an account exists for this email, we've sent a reset li |
| 16 | POST | `/api/auth/reset-password` | auth/routes | public | authRateLimit | body:resetPasswordSchema | json { message: 'Password updated. You can now sign in.' } |
| 17 | POST | `/api/auth/accept-invitation` | auth/routes | public | authRateLimit | body:acceptInvitationSchema | json { user: null, roles: [], conference: null, signed_in: false } |
| 18 | GET | `/api/invitations/:token` | invitations/routes | public | authRateLimit |  | json { invitation: await getInvitationByToken(req.params.token!) } |
| 19 | POST | `/api/invitations/:token/accept` | invitations/routes | public | authRateLimit | body:acceptSchema | json { user: profile, roles, conference: { id: conference.id, slug: confere |
| 20 | POST | `/api/invitations/:token/decline` | invitations/routes | public | authRateLimit |  | json await declineInvitationByToken(req.params.token!, auditContextFrom(req |
| 21 | GET | `/api/conferences/public-deadlines` | conferences/publicExtras.routes | public |  | query:deadlinesQuerySchema | json { deadlines: rows } |
| 22 | GET | `/api/conferences/public-track-count` | conferences/publicExtras.routes | public |  |  | json { count: Number((rows as Array<{ count: number }>)[0]?.count ?? 0) } |
| 23 | GET | `/api/conferences/public-stats` | conferences/publicExtras.routes | public |  |  | json { conferences: Number(row.conferences ?? 0), submissions: Number(row.s |
| 24 | GET | `/api/conferences/public` | conferences/routes | public |  |  | json { conferences } |
| 25 | GET | `/api/conferences/:slug` | conferences/routes | public |  |  | json result |
| 26 | GET | `/api/conferences/:id/details` | conferences/manage.routes | conf-perm: conference.manage |  |  | json { conference: await getConferenceForManagement(req.params.id!) } |
| 27 | PATCH | `/api/conferences/:id` | conferences/manage.routes | conf-perm: conference.manage |  | body:updateConferenceSchema | json { message: 'Conference updated.' } |
| 28 | POST | `/api/conferences/:id/logo` | conferences/manage.routes | conf-perm: conference.manage | uploadRateLimit, imageUpload(LOGO_MAX_BYTES) |  | json { path: relativePath } |
| 29 | DELETE | `/api/conferences/:id/logo` | conferences/manage.routes | conf-perm: conference.manage |  |  | json { message: 'Removed.' } |
| 30 | POST | `/api/conferences/:id/banner` | conferences/manage.routes | conf-perm: conference.manage | uploadRateLimit, imageUpload(BANNER_MAX_BYTES) |  | json { path: relativePath } |
| 31 | DELETE | `/api/conferences/:id/banner` | conferences/manage.routes | conf-perm: conference.manage |  |  | json { message: 'Removed.' } |
| 32 | GET | `/api/conferences/:id/role-requests` | roleRequests/routes | auth |  | query:listRoleRequestsQuerySchema | json { requests } |
| 33 | GET | `/api/conferences/:id/deadlines` | deadlines/routes | conf-perm: deadline.manage |  |  | json { deadlines } |
| 34 | PUT | `/api/conferences/:id/deadlines` | deadlines/routes | conf-perm: deadline.manage |  | body:updateDeadlinesSchema | json { message: 'Key dates saved.' } |
| 35 | GET | `/api/conferences/:id/tracks` | tracks/routes | conf-perm: conference.manage |  |  | json { tracks } |
| 36 | POST | `/api/conferences/:id/tracks` | tracks/routes | conf-perm: conference.manage |  | body:createTrackSchema | json result [201] |
| 37 | POST | `/api/conferences/:id/tracks/reorder` | tracks/routes | conf-perm: conference.manage |  | body:reorderTracksSchema | json { message: 'Tracks reordered.' } |
| 38 | PATCH | `/api/conferences/:id/tracks/:trackId` | tracks/routes | conf-perm: conference.manage |  | body:updateTrackSchema | json { message: 'Track updated.' } |
| 39 | PATCH | `/api/conferences/:id/tracks/:trackId/deactivate` | tracks/routes | conf-perm: conference.manage |  | body:setActiveSchema | json { message: 'Track updated.' } |
| 40 | GET | `/api/conferences/:id/supporters` | supporters/routes | conf-perm: conference.manage |  |  | json { supporters } |
| 41 | POST | `/api/conferences/:id/supporters` | supporters/routes | conf-perm: conference.manage |  | body:createSupporterSchema | json result [201] |
| 42 | POST | `/api/conferences/:id/supporters/reorder` | supporters/routes | conf-perm: conference.manage |  | body:reorderSupportersSchema | json { message: 'Supporters reordered.' } |
| 43 | PATCH | `/api/conferences/:id/supporters/:supporterId` | supporters/routes | conf-perm: conference.manage |  | body:updateSupporterSchema | json { message: 'Supporter updated.' } |
| 44 | PATCH | `/api/conferences/:id/supporters/:supporterId/active` | supporters/routes | conf-perm: conference.manage |  | body:setActiveSchema | json { message: 'Supporter updated.' } |
| 45 | DELETE | `/api/conferences/:id/supporters/:supporterId` | supporters/routes | conf-perm: conference.manage |  |  | json { message: 'Supporter deleted.' } |
| 46 | POST | `/api/conferences/:id/supporters/:supporterId/logo` | supporters/routes | conf-perm: conference.manage | uploadRateLimit, imageUpload(LOGO_MAX_BYTES) |  | json { path: relativePath } |
| 47 | DELETE | `/api/conferences/:id/supporters/:supporterId/logo` | supporters/routes | conf-perm: conference.manage |  |  | json { message: 'Removed.' } |
| 48 | GET | `/api/conferences/:id/rooms` | schedule/routes | conf-perm: schedule.manage |  |  | json { rooms: await listRooms(req.params.id!) } |
| 49 | POST | `/api/conferences/:id/rooms` | schedule/routes | conf-perm: schedule.manage |  | body:roomSchema | json await createRoom(req.user!.id, req.params.id!, req.body) [201] |
| 50 | PATCH | `/api/conferences/:id/rooms/:roomId` | schedule/routes | conf-perm: schedule.manage |  | body:roomSchema | json { message: 'Room updated.' } |
| 51 | PATCH | `/api/conferences/:id/rooms/:roomId/status` | schedule/routes | conf-perm: schedule.manage |  | body:setRoomStatusSchema | json { message: 'Room updated.' } |
| 52 | GET | `/api/conferences/:id/schedule-slots` | schedule/routes | conf-perm: schedule.manage |  |  | json { slots: await listScheduleSlots(req.params.id!) } |
| 53 | POST | `/api/conferences/:id/schedule-slots` | schedule/routes | conf-perm: schedule.manage |  | body:scheduleSlotSchema | json await createScheduleSlot(req.user!.id, req.params.id!, req.body) [201] |
| 54 | PATCH | `/api/conferences/:id/schedule-slots/:slotId` | schedule/routes | conf-perm: schedule.manage |  | body:scheduleSlotSchema | json { message: 'Slot updated.' } |
| 55 | DELETE | `/api/conferences/:id/schedule-slots/:slotId` | schedule/routes | conf-perm: schedule.manage |  |  | json { message: 'Slot deleted.' } |
| 56 | POST | `/api/conferences/:id/schedule-slots/copy-day` | schedule/routes | conf-perm: schedule.manage |  | body:copyDaySchema | json await copyScheduleDay(req.user!.id, req.params.id!, req.body) |
| 57 | GET | `/api/conferences/:id/sessions/public` | schedule/routes | public |  |  | json { schedule } |
| 58 | GET | `/api/conferences/:id/sessions/public/:sessionId/ics` | schedule/routes | public |  |  | file/stream (text/calendar; charset=utf-8) |
| 59 | GET | `/api/conferences/:id/sessions/public/programme.pdf` | schedule/routes | public |  |  | file/stream (application/pdf) |
| 60 | GET | `/api/conferences/:id/sessions` | schedule/routes | conf-perm: schedule.manage |  |  | json { sessions: await listSessions(req.params.id!) } |
| 61 | GET | `/api/conferences/:id/sessions/detailed` | schedule/routes | conf-perm: schedule.manage |  |  | json { sessions: await getConvenorSchedule(req.params.id!) } |
| 62 | GET | `/api/conferences/:id/sessions/warnings` | schedule/routes | conf-perm: schedule.manage |  |  | json await getScheduleWarnings(req.params.id!) |
| 63 | GET | `/api/conferences/:id/sessions/schedulable-submissions` | schedule/routes | conf-perm: schedule.manage |  |  | json { submissions: await listSchedulableSubmissions(req.params.id!, trackI |
| 64 | GET | `/api/conferences/:id/sessions/chair-candidates` | schedule/routes | conf-perm: schedule.manage |  |  | json { candidates: await listChairCandidates(req.params.id!) } |
| 65 | POST | `/api/conferences/:id/sessions` | schedule/routes | conf-perm: schedule.manage |  | body:sessionSchema | json await createSession(req.user!.id, req.params.id!, req.body) [201] |
| 66 | GET | `/api/conferences/:id/sessions/:sessionId` | schedule/routes | conf-perm: schedule.manage |  |  | json { session } |
| 67 | PATCH | `/api/conferences/:id/sessions/:sessionId` | schedule/routes | conf-perm: schedule.manage |  | body:sessionSchema | json { message: 'Session updated.' } |
| 68 | DELETE | `/api/conferences/:id/sessions/:sessionId` | schedule/routes | conf-perm: schedule.manage |  |  | json { message: 'Session deleted.' } |
| 69 | POST | `/api/conferences/:id/sessions/:sessionId/chairs` | schedule/routes | conf-perm: schedule.manage |  | body:sessionChairSchema | json { message: 'Chair assigned.' } [201] |
| 70 | DELETE | `/api/conferences/:id/sessions/:sessionId/chairs/:userId` | schedule/routes | conf-perm: schedule.manage |  |  | json { message: 'Chair removed.' } |
| 71 | POST | `/api/conferences/:id/sessions/:sessionId/presentations/papers` | schedule/routes | conf-perm: schedule.manage |  | body:addPaperPresentationSchema | json await addPaperPresentation(req.user!.id, req.params.id!, req.params.se [201] |
| 72 | POST | `/api/conferences/:id/sessions/:sessionId/presentations/speakers` | schedule/routes | conf-perm: schedule.manage |  | body:addSpeakerPresentationSchema | json await addSpeakerPresentation(req.user!.id, req.params.id!, req.params. [201] |
| 73 | DELETE | `/api/conferences/:id/sessions/:sessionId/presentations/:presentationId` | schedule/routes | conf-perm: schedule.manage |  |  | json { message: 'Removed from the programme.' } |
| 74 | POST | `/api/conferences/:id/sessions/:sessionId/presentations/reorder` | schedule/routes | conf-perm: schedule.manage |  | body:reorderPresentationsSchema | json { message: 'Reordered.' } |
| 75 | PATCH | `/api/conferences/:id/sessions/:sessionId/presentations/:presentationId/mark` | schedule/routes | auth +handler check |  | body:markPresentationSchema | json { message: 'Updated.' } |
| 76 | GET | `/api/conferences/:id/sessions/:sessionId/chair-view` | schedule/routes | auth +handler check |  |  | json { session } |
| 77 | GET | `/api/conferences/:id/my-presentations` | schedule/routes | auth |  |  | json { presentations: await getMyPresentations(req.params.id!, req.user!.id |
| 78 | GET | `/api/conferences/:id/sessions/:sessionId/timer` | sessionTimer/routes | auth +handler check |  |  | json await getTimerData(req.params.id!, req.params.sessionId!) |
| 79 | GET | `/api/conferences/:id/timer-defaults` | sessionTimer/routes | conf-perm: schedule.manage |  |  | json await getTimerDefaults(req.params.id!) |
| 80 | PUT | `/api/conferences/:id/timer-defaults` | sessionTimer/routes | conf-perm: schedule.manage |  | body:timerDefaultsSchema | json await updateTimerDefaults(req.user!.id, req.params.id!, req.body, audi |
| 81 | PUT | `/api/conferences/:id/sessions/:sessionId/timer-settings` | sessionTimer/routes | conf-perm: schedule.manage |  | body:sessionTimingSchema | json { message: 'Saved.' } |
| 82 | GET | `/api/conferences/:id/abstract-book` | abstractBook/routes | conf-perm: schedule.manage |  |  | json await getAbstractBookStatus(req.params.id!) |
| 83 | POST | `/api/conferences/:id/abstract-book/generate` | abstractBook/routes | conf-perm: schedule.manage |  | body:generateBookSchema | json { book: await generateBook(req.user!.id, req.params.id!, req.body, aud |
| 84 | PATCH | `/api/conferences/:id/abstract-book/publish` | abstractBook/routes | conf-perm: schedule.manage |  | body:publishBookSchema | json { message: req.body.is_published ? 'Published on the conference page.' |
| 85 | GET | `/api/conferences/:id/abstract-book/download` | abstractBook/routes | conf-perm: schedule.manage |  |  | file/stream |
| 86 | GET | `/api/conferences/:id/abstract-book/public` | abstractBook/routes | public |  |  | json await getPublicBookInfo(req.params.id!) |
| 87 | GET | `/api/conferences/:id/abstract-book/public.pdf` | abstractBook/routes | public |  |  | file/stream |
| 88 | GET | `/api/conferences/:id/feedback-survey` | feedback/routes | conf-perm: conference.manage |  |  | json await getSurveyAdmin(req.params.id!) |
| 89 | PUT | `/api/conferences/:id/feedback-survey` | feedback/routes | conf-perm: conference.manage |  | body:saveSurveySchema | json await saveSurvey(req.user!.id, req.params.id!, req.body, auditContextF |
| 90 | PATCH | `/api/conferences/:id/feedback-survey/open` | feedback/routes | conf-perm: conference.manage |  | body:setOpenSchema | json await setSurveyOpen(req.user!.id, req.params.id!, req.body.is_open, au |
| 91 | POST | `/api/conferences/:id/feedback-survey/invite` | feedback/routes | conf-perm: conference.manage |  |  | json await sendInvitations(req.user!.id, req.params.id!, auditContextFrom(r |
| 92 | GET | `/api/conferences/:id/feedback-survey/results` | feedback/routes | conf-perm: conference.manage |  |  | json await getResults(req.params.id!) |
| 93 | GET | `/api/conferences/:id/feedback-survey/results.xlsx` | feedback/routes | conf-perm: conference.manage |  |  | file/stream (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet) |
| 94 | GET | `/api/conferences/:id/feedback-survey/form` | feedback/routes | auth |  |  | json await getSurveyForm(req.params.id!, req.user!.id) |
| 95 | POST | `/api/conferences/:id/feedback-survey/responses` | feedback/routes | auth |  | body:submitResponseSchema | json await submitResponse(req.params.id!, req.user!.id, req.body) [201] |
| 96 | GET | `/api/conferences/:id/settings` | settings/routes | conf-role: [convenor] |  |  | json { settings: await getSettings(req.params.id!) } |
| 97 | PATCH | `/api/conferences/:id/settings` | settings/routes | conf-role: [convenor] |  | body:updateSettingsSchema | json { message: 'Settings saved.' } |
| 98 | GET | `/api/conferences/:id/author-form` | submissions/routes | auth |  |  | json await getAuthorFormData(req.user!.id, req.params.id!) |
| 99 | GET | `/api/conferences/:id/my-submissions` | submissions/routes | auth |  |  | json { submissions: await listMySubmissions(req.user!.id, req.params.id!) } |
| 100 | POST | `/api/conferences/:id/submissions` | submissions/routes | auth | refuseWhenConferenceEnded | body:createSubmissionSchema | file/stream; json result [201] |
| 101 | GET | `/api/conferences/:id/submissions` | reviews/routes | auth |  | query:listSubmissionsQuerySchema | json { submissions } |
| 102 | GET | `/api/conferences/:id/submissions/:sid` | reviews/routes | auth |  |  | json await getSubmissionOverviewDetail(req.user!.id, req.params.id!, req.pa |
| 103 | GET | `/api/conferences/:id/reviewers` | reviews/routes | auth |  |  | json { error: { message: 'submission_id is required.' } } [400] |
| 104 | POST | `/api/conferences/:id/submissions/:sid/assignments` | reviews/routes | auth |  | body:assignReviewerSchema | json result [201] |
| 105 | DELETE | `/api/conferences/:id/assignments/:aid` | reviews/routes | auth |  | body:cancelAssignmentSchema | json { message: 'Assignment cancelled.' } |
| 106 | POST | `/api/conferences/:id/conflicts` | reviews/routes | auth |  | body:addConflictSchema | json result [201] |
| 107 | POST | `/api/conferences/:id/auto-assign/preview` | reviews/routes | auth |  | body:autoAssignPreviewSchema | json await previewAutoAssign(req.user!.id, req.params.id!, req.body) |
| 108 | POST | `/api/conferences/:id/auto-assign/confirm` | reviews/routes | auth |  | body:autoAssignConfirmSchema | json await confirmAutoAssign(req.user!.id, req.params.id!, req.body) [201] |
| 109 | GET | `/api/conferences/:id/reviewers-pending` | reviews/routes | auth |  |  | json { reviewers: await listReviewersWithPendingReviews(req.user!.id, req.p |
| 110 | POST | `/api/conferences/:id/reviewers/:reviewerId/remind` | reviews/routes | auth |  |  | json await sendManualReminder(req.user!.id, req.params.id!, req.params.revi |
| 111 | POST | `/api/conferences/:id/remind-all` | reviews/routes | auth |  |  | json await sendAllPendingReminders(req.user!.id, req.params.id!) |
| 112 | POST | `/api/conferences/:id/submissions/:sid/decisions` | reviews/routes | auth |  | body:decisionSchema | json { message: 'Decision recorded.' } [201] |
| 113 | GET | `/api/conferences/:id/email-log` | emails/routes | auth |  | query:listEmailLogQuerySchema | json await listEmailLogForConference(req.user!.id, req.params.id!, req.quer |
| 114 | POST | `/api/conferences/:id/email-log/:logId/retry` | emails/routes | auth |  |  | json { message: 'Email queued for another attempt.' } |
| 115 | GET | `/api/conferences/:id/dashboard` | dashboard/routes | conf-perm: conference.view_internal |  |  | json await getDashboard(req.params.id!) |
| 116 | GET | `/api/conferences/:id/members` | members/routes | conf-perm: members.manage |  | query:listMembersQuerySchema | json { members: await listMembers(req.params.id!, req.query as never) } |
| 117 | POST | `/api/conferences/:id/members/invite` | members/routes | conf-perm: members.manage | emailTriggerRateLimit | body:inviteMemberSchema | json await inviteMember(req.user!.id, req.params.id!, req.body, auditContex [201] |
| 118 | GET | `/api/conferences/:id/members/invitations` | members/routes | conf-perm: members.manage |  |  | json { invitations: await listInvitations(req.params.id!) } |
| 119 | POST | `/api/conferences/:id/members/invitations/:invitationId/resend` | members/routes | conf-perm: members.manage | emailTriggerRateLimit |  | json await resendInvitation(req.user!.id, req.params.id!, req.params.invita |
| 120 | DELETE | `/api/conferences/:id/members/invitations/:invitationId` | members/routes | conf-perm: members.manage |  |  | json { message: 'Invitation cancelled.' } |
| 121 | PATCH | `/api/conferences/:id/members/:membershipId/role` | members/routes | conf-perm: members.manage |  | body:changeRoleSchema | json { message: 'Role changed.' } |
| 122 | PATCH | `/api/conferences/:id/members/:membershipId/max-review-load` | members/routes | conf-perm: members.manage |  | body:setMaxReviewLoadSchema | json { message: 'Saved.' } |
| 123 | DELETE | `/api/conferences/:id/members/:membershipId` | members/routes | conf-perm: members.manage |  |  | json { message: 'Member removed.' } |
| 124 | GET | `/api/conferences/:id/members/:userId/reviewer-tracks` | members/routes | conf-perm: members.manage |  |  | json { track_ids: await listReviewerTracks(req.params.id!, req.params.userI |
| 125 | PUT | `/api/conferences/:id/members/:userId/reviewer-tracks` | members/routes | conf-perm: members.manage |  | body:setReviewerTracksSchema | json { message: 'Saved.' } |
| 126 | GET | `/api/conferences/:id/committees/user-lookup` | committees/routes | conf-perm: committee.manage |  |  | json { user: email ? await lookupUserByEmail(email) : null } |
| 127 | GET | `/api/conferences/:id/committees` | committees/routes | conf-perm: committee.manage |  |  | json { committees: await listCommittees(req.params.id!) } |
| 128 | POST | `/api/conferences/:id/committees` | committees/routes | conf-perm: committee.manage |  | body:createCommitteeSchema | json await createCommittee(req.user!.id, req.params.id!, req.body) [201] |
| 129 | POST | `/api/conferences/:id/committees/reorder` | committees/routes | conf-perm: committee.manage |  | body:reorderCommitteesSchema | json { message: 'Committees reordered.' } |
| 130 | PATCH | `/api/conferences/:id/committees/:committeeId` | committees/routes | conf-perm: committee.manage |  | body:updateCommitteeSchema | json { message: 'Committee updated.' } |
| 131 | DELETE | `/api/conferences/:id/committees/:committeeId` | committees/routes | conf-perm: committee.manage |  |  | json { message: 'Committee deleted.' } |
| 132 | POST | `/api/conferences/:id/committees/:committeeId/members` | committees/routes | conf-perm: committee.manage |  | body:createCommitteeMemberSchema | json await addCommitteeMember(req.user!.id, req.params.id!, req.params.comm [201] |
| 133 | POST | `/api/conferences/:id/committees/:committeeId/members/reorder` | committees/routes | conf-perm: committee.manage |  | body:reorderCommitteeMembersSchema | json { message: 'Members reordered.' } |
| 134 | PATCH | `/api/conferences/:id/committees/:committeeId/members/:memberId` | committees/routes | conf-perm: committee.manage |  | body:updateCommitteeMemberSchema | json { message: 'Member updated.' } |
| 135 | DELETE | `/api/conferences/:id/committees/:committeeId/members/:memberId` | committees/routes | conf-perm: committee.manage |  |  | json { message: 'Member removed.' } |
| 136 | GET | `/api/conferences/:id/speakers` | speakers/routes | conf-perm: conference.manage |  |  | json { speakers: await listSpeakers(req.params.id!) } |
| 137 | POST | `/api/conferences/:id/speakers` | speakers/routes | conf-perm: conference.manage |  | body:createSpeakerSchema | json await createSpeaker(req.user!.id, req.params.id!, req.body) [201] |
| 138 | POST | `/api/conferences/:id/speakers/reorder` | speakers/routes | conf-perm: conference.manage |  | body:reorderSpeakersSchema | json { message: 'Speakers reordered.' } |
| 139 | PATCH | `/api/conferences/:id/speakers/:speakerId` | speakers/routes | conf-perm: conference.manage |  | body:updateSpeakerSchema | json { message: 'Speaker updated.' } |
| 140 | DELETE | `/api/conferences/:id/speakers/:speakerId` | speakers/routes | conf-perm: conference.manage |  |  | json { message: 'Speaker deleted.' } |
| 141 | POST | `/api/conferences/:id/speakers/:speakerId/photo` | speakers/routes | conf-perm: conference.manage | uploadRateLimit, imageUpload(PHOTO_MAX_BYTES) |  | json { path: relativePath } |
| 142 | DELETE | `/api/conferences/:id/speakers/:speakerId/photo` | speakers/routes | conf-perm: conference.manage |  |  | json { message: 'Removed.' } |
| 143 | GET | `/api/conferences/:id/announcements` | announcements/routes | conf-perm: announcement.manage |  |  | json { announcements: await listAnnouncements(req.params.id!) } |
| 144 | POST | `/api/conferences/:id/announcements` | announcements/routes | conf-perm: announcement.manage |  | body:createAnnouncementSchema | json await createAnnouncement(req.user!.id, req.params.id!, req.body) [201] |
| 145 | PATCH | `/api/conferences/:id/announcements/:announcementId` | announcements/routes | conf-perm: announcement.manage |  | body:updateAnnouncementSchema | json { message: 'Announcement updated.' } |
| 146 | POST | `/api/conferences/:id/announcements/:announcementId/publish` | announcements/routes | conf-perm: announcement.manage |  |  | json { message: 'Announcement published.' } |
| 147 | POST | `/api/conferences/:id/announcements/:announcementId/archive` | announcements/routes | conf-perm: announcement.manage |  |  | json { message: 'Announcement archived.' } |
| 148 | DELETE | `/api/conferences/:id/announcements/:announcementId` | announcements/routes | conf-perm: announcement.manage |  |  | json { message: 'Announcement deleted.' } |
| 149 | GET | `/api/conferences/:id/bulk-email` | bulkEmail/routes | conf-perm: communication.bulk_email |  |  | json { bulk_emails: await listBulkEmails(req.params.id!) } |
| 150 | GET | `/api/conferences/:id/bulk-email/:bulkEmailId` | bulkEmail/routes | conf-perm: communication.bulk_email |  |  | json await getBulkEmailDetail(req.params.id!, req.params.bulkEmailId!) |
| 151 | POST | `/api/conferences/:id/bulk-email/recipients-preview` | bulkEmail/routes | conf-perm: communication.bulk_email |  | body:previewRecipientsSchema | json await previewRecipients(req.params.id!, req.body.groups) |
| 152 | POST | `/api/conferences/:id/bulk-email/content-preview` | bulkEmail/routes | conf-perm: communication.bulk_email |  | body:previewContentSchema | json await previewContent(req.params.id!, req.body) |
| 153 | POST | `/api/conferences/:id/bulk-email` | bulkEmail/routes | conf-perm: communication.bulk_email |  | body:saveDraftSchema | json await createDraft(req.user!.id, req.params.id!, req.body) [201] |
| 154 | PATCH | `/api/conferences/:id/bulk-email/:bulkEmailId` | bulkEmail/routes | conf-perm: communication.bulk_email |  | body:saveDraftSchema | json { message: 'Draft saved.' } |
| 155 | DELETE | `/api/conferences/:id/bulk-email/:bulkEmailId` | bulkEmail/routes | conf-perm: communication.bulk_email |  |  | json { message: 'Draft deleted.' } |
| 156 | POST | `/api/conferences/:id/bulk-email/:bulkEmailId/test` | bulkEmail/routes | conf-perm: communication.bulk_email | emailTriggerRateLimit |  | json { message: 'Test email queued — check your inbox shortly.' } |
| 157 | POST | `/api/conferences/:id/bulk-email/:bulkEmailId/send` | bulkEmail/routes | conf-perm: communication.bulk_email | emailTriggerRateLimit |  | json await sendBulkEmail(req.user!.id, req.params.id!, req.params.bulkEmail |
| 158 | GET | `/api/conferences/:id/email-templates` | emailTemplates/routes | conf-perm: conference.manage |  |  | json { templates: await listEmailTemplates(req.params.id!) } |
| 159 | GET | `/api/conferences/:id/email-templates/:templateKey/preview` | emailTemplates/routes | conf-perm: conference.manage |  |  | json await previewEmailTemplate(req.params.id!, req.params.templateKey!) |
| 160 | POST | `/api/conferences/:id/email-templates/:templateKey` | emailTemplates/routes | conf-perm: conference.manage |  | body:saveEmailTemplateSchema | json { message: 'Template saved.' } |
| 161 | POST | `/api/conferences/:id/email-templates/:templateKey/reset` | emailTemplates/routes | conf-perm: conference.manage |  |  | json { message: 'Reset to the platform default.' } |
| 162 | GET | `/api/conferences/:id/reports/:kind/csv` | reports/routes | conf-perm: report.view +handler check |  |  | file/stream (text/csv; charset=utf-8) |
| 163 | GET | `/api/conferences/:id/reports/:kind/xlsx` | reports/routes | conf-perm: report.view +handler check |  |  | file/stream (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet) |
| 164 | GET | `/api/conferences/:id/activity-log` | activityLog/routes | conf-perm: audit.read |  | query:activityLogQuerySchema | json await listActivityLog(req.params.id!, req.query as never) |
| 165 | GET | `/api/conferences/:id/registration-categories/public` | registration/routes | public |  |  | json options |
| 166 | GET | `/api/conferences/:id/registration-categories` | registration/routes | auth |  |  | json { categories: await listCategories(req.params.id!) } |
| 167 | POST | `/api/conferences/:id/registration-categories` | registration/routes | conf-perm: registration.manage |  | body:registrationCategorySchema | json await createCategory(req.user!.id, req.params.id!, req.body, auditCont [201] |
| 168 | PATCH | `/api/conferences/:id/registration-categories/:categoryId` | registration/routes | conf-perm: registration.manage |  | body:registrationCategorySchema | json { message: 'Category updated.' } |
| 169 | GET | `/api/conferences/:id/registration-fees` | registration/routes | conf-perm: registration.read_all |  |  | json { fees: await listFees(req.params.id!) } |
| 170 | POST | `/api/conferences/:id/registration-categories/:categoryId/fees` | registration/routes | conf-perm: registration.manage |  | body:registrationFeeSchema | json await createFee(req.user!.id, req.params.id!, req.params.categoryId!,  [201] |
| 171 | PATCH | `/api/conferences/:id/registration-fees/:feeId` | registration/routes | conf-perm: registration.manage |  | body:registrationFeeSchema | json { message: 'Price updated.' } |
| 172 | DELETE | `/api/conferences/:id/registration-fees/:feeId` | registration/routes | conf-perm: registration.manage |  |  | json { message: deactivated ? 'Price switched off (people already registere |
| 173 | GET | `/api/conferences/:id/registrations/:registrationId/payments` | registration/routes | conf-perm: payment.read_all |  |  | json await listPayments(req.params.id!, req.params.registrationId!) |
| 174 | POST | `/api/conferences/:id/registrations/:registrationId/payments` | registration/routes | conf-perm: payment.manage |  | body:paymentSchema | json await recordPayment(req.user!.id, req.params.id!, req.params.registrat [201] |
| 175 | POST | `/api/conferences/:id/registrations/:registrationId/payments/:paymentId/void` | registration/routes | conf-perm: payment.manage |  | body:reasonSchema | json { message: 'Payment voided.' } |
| 176 | POST | `/api/conferences/:id/registrations/:registrationId/waive` | registration/routes | conf-perm: registration.manage |  | body:reasonSchema | json { message: 'Fee waived.' } |
| 177 | GET | `/api/conferences/:id/my-registration` | registration/routes | auth |  |  | json { registration: await getMyRegistration(req.params.id!, req.user!.id)  |
| 178 | GET | `/api/conferences/:id/my-registration/qr.png` | registration/routes | auth |  |  | file/stream (image/png) |
| 179 | POST | `/api/conferences/:id/register` | registration/routes | auth | refuseWhenConferenceEnded | body:registerSchema | json await register(req.params.id!, req.user!.id, req.body.category_id, aud [201] |
| 180 | DELETE | `/api/conferences/:id/my-registration` | registration/routes | auth | refuseWhenConferenceEnded |  | json { message: 'Registration cancelled.' } |
| 181 | GET | `/api/conferences/:id/registrations` | registration/routes | conf-perm: registration.read_all |  |  | json await listRegistrations(req.params.id!, { search, status, categoryId,  |
| 182 | GET | `/api/conferences/:id/registrations/export.csv` | registration/routes | conf-perm: registration.read_all |  |  | file/stream (text/csv; charset=utf-8) |
| 183 | PATCH | `/api/conferences/:id/registrations/:registrationId/confirm` | registration/routes | conf-perm: registration.manage |  |  | json { message: 'Registration confirmed.' } |
| 184 | DELETE | `/api/conferences/:id/registrations/:registrationId` | registration/routes | conf-perm: registration.manage |  |  | json { message: 'Registration cancelled.' } |
| 185 | GET | `/api/conferences/:id/registrations/search` | registration/routes | auth +handler check |  |  | json { registrations: [] } |
| 186 | GET | `/api/conferences/:id/registrations/lookup` | registration/routes | conf-perm: attendance.record |  | query:checkinLookupQuerySchema | json result |
| 187 | POST | `/api/conferences/:id/checkin` | registration/routes | conf-perm: attendance.record | refuseWhenConferenceEnded | body:checkinSchema | json await checkinByQrToken(req.user!.id, req.params.id!, req.body.qr_token |
| 188 | POST | `/api/conferences/:id/checkin/manual` | registration/routes | conf-perm: attendance.record | refuseWhenConferenceEnded | body:manualCheckinSchema | json await checkinByRegistrationId(req.user!.id, req.params.id!, req.body.r |
| 189 | POST | `/api/conferences/:id/checkin/:registrationId/checkout` | registration/routes | conf-perm: attendance.record |  |  | json { message: 'Checked out.' } |
| 190 | GET | `/api/conferences/:id/attendance/dashboard` | registration/routes | conf-perm: attendance.record |  |  | json await getAttendanceDashboard(req.params.id!) |
| 191 | GET | `/api/conferences/:id/attendance/recent` | registration/routes | conf-perm: attendance.record |  |  | json { checkins: await listRecentCheckins(req.params.id!) } |
| 192 | POST | `/api/conferences/:id/sessions/:sessionId/checkin` | registration/routes | auth +handler check | refuseWhenConferenceEnded | body:sessionCheckinSchema | json await sessionCheckinByQrToken(req.user!.id, req.params.id!, req.params |
| 193 | POST | `/api/conferences/:id/sessions/:sessionId/checkin/manual` | registration/routes | auth +handler check | refuseWhenConferenceEnded | body:manualSessionCheckinSchema | json await sessionCheckinByRegistrationId( req.user!.id, req.params.id!, re |
| 194 | GET | `/api/conferences/:id/my-ticket` | audience/routes | auth |  |  | json ticket |
| 195 | POST | `/api/conferences/:id/my-ticket/email` | audience/routes | auth +handler check |  |  | json { message: 'Your ticket is on its way to your email.' } |
| 196 | GET | `/api/conferences/:id/audience/programme` | audience/routes | conf-perm: audience.view_content |  |  | json await getAudienceProgramme(req.params.id!, req.user!.id) |
| 197 | GET | `/api/conferences/:id/audience/speakers` | audience/routes | conf-perm: audience.view_content |  |  | json { speakers: await getAudienceSpeakers(req.params.id!) } |
| 198 | POST | `/api/conferences/:id/audience/sessions/:sessionId/join-online` | audience/routes | conf-perm: audience.view_content | refuseWhenConferenceEnded |  | json result |
| 199 | GET | `/api/conferences/:id/audience/sessions/:sessionId/questions` | audience/routes | conf-perm: audience.view_content |  |  | json await listAudienceQuestions(req.params.id!, req.params.sessionId!, req |
| 200 | POST | `/api/conferences/:id/audience/sessions/:sessionId/questions` | audience/routes | conf-perm: audience.ask_question | refuseWhenConferenceEnded, qaAskRateLimit | body:askQuestionSchema | json { id, message: 'Your question has been posted.' } [201] |
| 201 | PUT | `/api/conferences/:id/audience/questions/:questionId/vote` | audience/routes | conf-perm: audience.ask_question | refuseWhenConferenceEnded, qaVoteRateLimit |  | json await setVote(req.params.id!, req.params.questionId!, req.user!.id, tr |
| 202 | DELETE | `/api/conferences/:id/audience/questions/:questionId/vote` | audience/routes | conf-perm: audience.ask_question +handler check | refuseWhenConferenceEnded, qaVoteRateLimit |  | json await setVote(req.params.id!, req.params.questionId!, req.user!.id, fa |
| 203 | GET | `/api/conferences/:id/sessions/:sessionId/questions/moderate` | audience/routes | auth +handler check |  |  | json await listModeratorQuestions(req.params.id!, req.params.sessionId!, pa |
| 204 | PATCH | `/api/conferences/:id/sessions/:sessionId/questions/:questionId` | audience/routes | auth +handler check |  | body:moderateQuestionSchema | json { message: 'Updated.' } |
| 205 | DELETE | `/api/conferences/:id/sessions/:sessionId/questions/:questionId` | audience/routes | auth +handler check |  |  | json { message: 'Question deleted.' } |
| 206 | GET | `/api/conferences/:id/audience/feedback` | audience/routes | conf-perm: audience.give_feedback |  |  | json await getMyFeedback(req.params.id!, req.user!.id) |
| 207 | PUT | `/api/conferences/:id/audience/feedback` | audience/routes | conf-perm: audience.give_feedback |  | body:conferenceFeedbackSchema |  |
| 208 | PUT | `/api/conferences/:id/audience/sessions/:sessionId/rating` | audience/routes | conf-perm: audience.give_feedback |  | body:sessionRatingSchema |  |
| 209 | GET | `/api/conferences/:id/audience-feedback` | audience/routes | auth |  |  | json await getFeedbackSummary(req.params.id!, scope, parseFeedbackFilters(r |
| 210 | GET | `/api/conferences/:id/audience-feedback/export.csv` | audience/routes | auth |  |  | file/stream (text/csv; charset=utf-8) |
| 211 | PATCH | `/api/conferences/:id/audience-feedback/:kind/:itemId` | audience/routes | conf-perm: audience.moderate |  | body:moderateFeedbackSchema | json { message: 'Updated.' } |
| 212 | DELETE | `/api/conferences/:id/audience-feedback/:kind/:itemId` | audience/routes | conf-perm: audience.moderate |  |  | json { message: 'Feedback deleted.' } |
| 213 | GET | `/api/conferences/:id/audience-settings` | audience/routes | conf-perm: conference.manage |  |  | json { settings: await readAudienceSettings(req.params.id!) } |
| 214 | PUT | `/api/conferences/:id/audience-settings` | audience/routes | conf-perm: conference.manage |  | body:audienceSettingsSchema | json { message: 'Audience settings saved.', settings: await readAudienceSet |
| 215 | GET | `/api/conferences/:id/materials` | audience/routes | conf-perm: conference.manage |  |  | json { materials: await listMaterials(req.params.id!) } |
| 216 | POST | `/api/conferences/:id/materials` | audience/routes | conf-perm: conference.manage | uploadRateLimit, materialUpload |  | json { error: { message: issue?.message ?? 'Check the form.', fields: { [fi [400,201] |
| 217 | PATCH | `/api/conferences/:id/materials/:materialId` | audience/routes | conf-perm: conference.manage |  | body:updateMaterialSchema | json { message: 'Saved.' } |
| 218 | DELETE | `/api/conferences/:id/materials/:materialId` | audience/routes | conf-perm: conference.manage |  |  | json { message: 'File deleted.' } |
| 219 | GET | `/api/conferences/:id/materials/:materialId/download` | audience/routes | conf-perm: conference.manage |  |  | file/stream |
| 220 | GET | `/api/conferences/:id/audience/materials` | audience/routes | conf-perm: audience.download_materials |  |  | json { materials: await listAudienceMaterials(req.params.id!) } |
| 221 | GET | `/api/conferences/:id/audience/materials/:kind/:itemId/download` | audience/routes | conf-perm: audience.download_materials |  |  | file/stream |
| 222 | GET | `/api/conferences/:id/submissions/:submissionId/audience-consent` | audience/routes | auth |  |  | json await getAudienceConsent(req.user!.id, req.params.id!, req.params.subm |
| 223 | PUT | `/api/conferences/:id/submissions/:submissionId/audience-consent` | audience/routes | auth |  | body:consentSchema | json { message: 'Saved.', ...(await getAudienceConsent(req.user!.id, req.pa |
| 224 | GET | `/api/conferences/:id/audience/abstracts` | audience/routes | conf-perm: audience.view_accepted_abstracts |  |  | json await listAcceptedAbstracts(req.params.id!, parseAbstractFilters(req.q |
| 225 | GET | `/api/conferences/:id/abstracts/public` | audience/routes | public |  |  | json await listAcceptedAbstracts(req.params.id!, parseAbstractFilters(req.q |
| 226 | GET | `/api/conferences/:id/audience/certificate-progress` | audience/routes | conf-perm: audience.view_content |  |  | json await getCertificateProgress(req.params.id!, req.user!.id) |
| 227 | GET | `/api/conferences/:id/audience-report` | audience/routes | conf-perm: report.view |  |  | json await getAudienceReport(req.params.id!) |
| 228 | GET | `/api/conferences/:id/audience-report/export.csv` | audience/routes | conf-perm: report.view |  |  | file/stream (text/csv; charset=utf-8) |
| 229 | GET | `/api/conferences/:id/audience-report/questions.csv` | audience/routes | conf-perm: report.view |  |  | file/stream (text/csv; charset=utf-8) |
| 230 | GET | `/api/conferences/:id/publication-info/public` | publication/routes | public |  |  | json { publication: await getPublicPublicationInfo(req.params.id!) } |
| 231 | GET | `/api/conferences/:id/publication-info` | publication/routes | conf-perm: conference.manage |  |  | json { publication: await getPublicationInfo(req.params.id!) } |
| 232 | PUT | `/api/conferences/:id/publication-info` | publication/routes | conf-perm: conference.manage |  | body:publicationInfoSchema | json { message: 'Publication information saved.' } |
| 233 | GET | `/api/conferences/:id/paper-publications` | publication/routes | conf-perm: submission.read_all |  |  | json { papers: await listPaperPublications(req.params.id!) } |
| 234 | GET | `/api/conferences/:id/submissions/:sid/publication` | publication/routes | conf-perm: submission.read_all |  |  | json { publication: await getPaperPublication(req.params.id!, req.params.si |
| 235 | PUT | `/api/conferences/:id/submissions/:sid/publication` | publication/routes | conf-perm: submission.manage |  | body:paperPublicationSchema | json { message: 'Publication saved.' } |
| 236 | POST | `/api/conferences/:id/paper-publications/publish-all` | publication/routes | conf-perm: submission.manage |  | body:publishAllSchema | json { published, message: published === 1 ? '1 paper marked as published.' |
| 237 | GET | `/api/conferences/:id/archive` | archive/routes | public |  |  | json await getPublicArchive(req.params.id!) |
| 238 | GET | `/api/conferences/:id/archive/papers/:sid/file` | archive/routes | public |  |  | file/stream |
| 239 | GET | `/api/conferences/:id/archive/report.pdf` | archive/routes | public |  |  | file/stream |
| 240 | GET | `/api/conferences/:id/conference-report` | archive/routes | conf-perm: conference.manage |  |  | json { report: await getReport(req.params.id!) } |
| 241 | PUT | `/api/conferences/:id/conference-report` | archive/routes | conf-perm: conference.manage |  | body:reportTextSchema | json { message: 'Report saved.' } |
| 242 | POST | `/api/conferences/:id/conference-report/pdf` | archive/routes | conf-perm: conference.manage | uploadRateLimit, reportUpload |  | json { message: 'PDF uploaded.' } [201] |
| 243 | DELETE | `/api/conferences/:id/conference-report/pdf` | archive/routes | conf-perm: conference.manage |  |  | json { message: 'PDF removed.' } |
| 244 | GET | `/api/conferences/:id/conference-report/pdf` | archive/routes | conf-perm: conference.manage |  |  | file/stream |
| 245 | POST | `/api/conferences/:id/conference-report/publish` | archive/routes | conf-perm: conference.manage |  |  | json { message: 'Report published.' } |
| 246 | POST | `/api/conferences/:id/conference-report/unpublish` | archive/routes | conf-perm: conference.manage |  |  | json { message: 'Report unpublished.' } |
| 247 | GET | `/api/conferences/:id/post-conference-email` | postConference/routes | conf-perm: communication.bulk_email |  |  | json await getPostConferenceState(req.params.id!) |
| 248 | POST | `/api/conferences/:id/post-conference-email/send` | postConference/routes | conf-perm: communication.bulk_email | emailTriggerRateLimit | body:saveDraftSchema | json await sendPostConferenceEmail(req.user!.id, req.params.id!, req.body) [201] |
| 249 | GET | `/api/conferences/:id/payment-settings` | registration/receipts.routes | conf-perm: registration.read_all |  |  | json await getPaymentSettings(req.params.id!) |
| 250 | PUT | `/api/conferences/:id/payment-settings` | registration/receipts.routes | conf-perm: registration.manage |  | body:paymentSettingsSchema | json { message: 'Payment instructions saved.' } |
| 251 | POST | `/api/conferences/:id/payment-settings/qr` | registration/receipts.routes | conf-perm: registration.manage | uploadRateLimit, withUpload(qrUpload, 'The image must be 2 MB or smaller.') |  | json { message: 'Payment QR uploaded.' } [201] |
| 252 | DELETE | `/api/conferences/:id/payment-settings/qr` | registration/receipts.routes | conf-perm: registration.manage |  |  | json { message: 'Payment QR removed.' } |
| 253 | GET | `/api/conferences/:id/payment-info/public` | registration/receipts.routes | public |  |  | json await getPublicPaymentInfo(req.params.id!) |
| 254 | GET | `/api/conferences/:id/payment-info/qr` | registration/receipts.routes | public |  |  | file/stream |
| 255 | POST | `/api/conferences/:id/my-registration/receipt` | registration/receipts.routes | auth | refuseWhenConferenceEnded, uploadRateLimit, withUpload(receiptUpload, 'The receipt must be 5 MB or smaller.') |  | json { message: 'Receipt uploaded. The organisers will confirm your registr [201] |
| 256 | GET | `/api/conferences/:id/my-registration/receipt` | registration/receipts.routes | auth |  |  | file/stream |
| 257 | GET | `/api/conferences/:id/registrations/:registrationId/receipt` | registration/receipts.routes | conf-perm: registration.manage |  |  | file/stream |
| 258 | POST | `/api/conferences/:id/registrations/:registrationId/reject` | registration/receipts.routes | conf-perm: registration.manage |  | body:rejectSchema | json { message: 'Receipt rejected. The participant was emailed the reason.' |
| 259 | POST | `/api/conferences/:id/registrations/bulk-confirm` | registration/receipts.routes | conf-perm: registration.manage |  | body:bulkConfirmSchema | json { confirmed, failed } |
| 260 | GET | `/api/conferences/:id/registrations/:registrationId/ticket-qr.png` | registration/receipts.routes | public |  |  | file/stream (image/png) |
| 261 | GET | `/api/conferences/:id/registrations/badges` | badges/routes | conf-perm: attendance.record |  | query:badgeFilterQuerySchema | json { candidates: await listBadgeCandidates(req.params.id!, req.query as n |
| 262 | GET | `/api/conferences/:id/registrations/badges.pdf` | badges/routes | conf-perm: attendance.record |  | query:badgeFilterQuerySchema | file/stream (application/pdf) |
| 263 | GET | `/api/conferences/:id/registrations/:registrationId/badge.pdf` | badges/routes | conf-perm: attendance.record |  |  | file/stream (application/pdf) |
| 264 | GET | `/api/conferences/:id/analytics` | analytics/routes | conf-perm: report.view |  | query:dateRangeQuerySchema | json await getConvenorAnalytics(req.params.id!, req.query as never) |
| 265 | GET | `/api/conferences/:id/analytics/report.pdf` | analytics/routes | conf-perm: report.view |  | query:dateRangeQuerySchema | file/stream (application/pdf) |
| 266 | GET | `/api/conferences/:id/analytics/report.xlsx` | analytics/routes | conf-perm: report.view |  | query:dateRangeQuerySchema | file/stream (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet); json await getPlatformAnalytics(req.query as never) |
| 267 | GET | `/api/admin/analytics` | analytics/routes | admin |  | query:dateRangeQuerySchema | json await getPlatformAnalytics(req.query as never) |
| 268 | GET | `/api/admin/analytics/report.pdf` | analytics/routes | admin |  | query:dateRangeQuerySchema | file/stream (application/pdf) |
| 269 | GET | `/api/admin/analytics/report.xlsx` | analytics/routes | admin |  | query:dateRangeQuerySchema | file/stream (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet) |
| 270 | GET | `/api/conferences/:id/certificate-templates` | certificates/routes | conf-perm: certificate.manage |  |  | json { templates: await listTemplates(req.params.id!) } |
| 271 | POST | `/api/conferences/:id/certificate-templates` | certificates/routes | conf-perm: certificate.manage |  | body:certificateTemplateSchema | json await createTemplate(req.user!.id, req.params.id!, req.body, auditCont [201] |
| 272 | PATCH | `/api/conferences/:id/certificate-templates/:templateId` | certificates/routes | conf-perm: certificate.manage |  | body:certificateTemplateSchema | json { message: 'Template updated.' } |
| 273 | POST | `/api/conferences/:id/certificate-templates/:templateId/background` | certificates/routes | conf-perm: certificate.manage | uploadRateLimit, imageUpload(BACKGROUND_MAX_BYTES) |  | json await setTemplateBackground(req.user!.id, req.params.id!, req.params.t |
| 274 | DELETE | `/api/conferences/:id/certificate-templates/:templateId/background` | certificates/routes | conf-perm: certificate.manage |  |  | json { message: 'Removed.' } |
| 275 | POST | `/api/conferences/:id/certificate-templates/:templateId/signatories/:index/signature` | certificates/routes | conf-perm: certificate.manage | uploadRateLimit, imageUpload(SIGNATURE_MAX_BYTES) |  | json { message: 'Signature uploaded.' } |
| 276 | DELETE | `/api/conferences/:id/certificate-templates/:templateId/signatories/:index/signature` | certificates/routes | conf-perm: certificate.manage |  |  | json { message: 'Removed.' } |
| 277 | POST | `/api/conferences/:id/certificate-templates/preview.pdf` | certificates/routes | conf-perm: certificate.manage |  | body:previewDraftSchema | file/stream (application/pdf) |
| 278 | GET | `/api/conferences/:id/certificate-templates/:templateId/preview.pdf` | certificates/routes | conf-perm: certificate.manage |  |  | file/stream (application/pdf) |
| 279 | GET | `/api/conferences/:id/certificates/preview` | certificates/routes | conf-perm: certificate.manage |  |  | json await previewEligibleCount(req.params.id!, parsed.data.certificate_typ |
| 280 | POST | `/api/conferences/:id/certificates/generate` | certificates/routes | conf-perm: certificate.manage |  | body:generateCertificatesSchema | json await generateCertificates(req.user!.id, req.params.id!, req.body.cert |
| 281 | POST | `/api/conferences/:id/certificates/best-paper` | certificates/routes | conf-perm: certificate.manage |  | body:issueBestPaperSchema | json await issueBestPaperCertificates(req.user!.id, req.params.id!, req.bod |
| 282 | POST | `/api/conferences/:id/certificates/speaker` | certificates/routes | conf-perm: certificate.manage |  | body:issueSpeakerCertificateSchema | json await issueSpeakerCertificate(req.user!.id, req.params.id!, req.body.s |
| 283 | POST | `/api/conferences/:id/certificates/release-now` | certificates/routes | conf-perm: certificate.manage |  |  | json { message: 'Certificates released.', released: result.released } |
| 284 | GET | `/api/conferences/:id/certificates` | certificates/routes | conf-perm: certificate.manage |  |  | json { certificates: await listCertificates(req.params.id!) } |
| 285 | PATCH | `/api/conferences/:id/certificates/:certificateId/revoke` | certificates/routes | conf-perm: certificate.manage |  | body:revokeCertificateSchema | json { message: 'Certificate revoked.' } |
| 286 | GET | `/api/conferences/:id/my-certificates` | certificates/routes | auth |  |  | json { certificates: await listMyCertificates(req.params.id!, req.user!.id) |
| 287 | GET | `/api/conferences/:id/certificates/:certificateId/download` | certificates/routes | auth +handler check |  |  | file/stream (application/pdf); json { result } |
| 288 | GET | `/api/verify/:token/pdf` | certificates/routes | public | publicDownloadRateLimit |  |  |
| 289 | GET | `/api/verify/:token` | certificates/routes | public |  |  | json { result } |
| 290 | GET | `/api/submissions/:sid` | submissions/routes | auth |  |  | json await getSubmissionDetail(req.user!.id, req.params.sid!) |
| 291 | PATCH | `/api/submissions/:sid` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded | body:updateSubmissionSchema | json await getSubmissionDetail(req.user!.id, req.params.sid!) |
| 292 | POST | `/api/submissions/:sid/submit` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded |  | json await getSubmissionDetail(req.user!.id, req.params.sid!) |
| 293 | POST | `/api/submissions/:sid/withdraw` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded | body:withdrawSubmissionSchema | json await getSubmissionDetail(req.user!.id, req.params.sid!) |
| 294 | DELETE | `/api/submissions/:sid` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded |  | json { message: 'Submission deleted.' } |
| 295 | POST | `/api/submissions/:sid/authors` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded | body:addAuthorSchema | json result [201] |
| 296 | PATCH | `/api/submissions/:sid/authors/:aid` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded | body:updateAuthorSchema | json { message: 'Author updated.' } |
| 297 | DELETE | `/api/submissions/:sid/authors/:aid` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded |  | json { message: 'Author removed.' } |
| 298 | POST | `/api/submissions/:sid/files/:kind` | submissions/routes | auth | refuseWhenSubmissionConferenceEnded, uploadRateLimit, upload |  | json result [201] |
| 299 | GET | `/api/submissions/:sid/files/:fileId/download` | submissions/routes | auth |  |  | file/stream |
| 300 | GET | `/api/reviewer/bids` | reviews/routes | auth |  | query:listBiddableQuerySchema | json await listBiddableSubmissions(req.user!.id, conference_id, filters) |
| 301 | PUT | `/api/reviewer/bids/:sid` | reviews/routes | auth | refuseWhenSubmissionConferenceEnded | body:upsertBidSchema | json { message: 'Bid saved.' } |
| 302 | GET | `/api/reviewer/assignments` | reviews/routes | auth |  |  | json { assignments: await listMyAssignments(req.user!.id, conferenceId) } |
| 303 | GET | `/api/reviewer/assignments/:aid` | reviews/routes | auth |  |  | json await getAssignmentDetail(req.user!.id, req.params.aid!) |
| 304 | POST | `/api/reviewer/assignments/:aid/accept` | reviews/routes | auth | refuseWhenAssignmentConferenceEnded |  | json { message: 'Assignment accepted.' } |
| 305 | POST | `/api/reviewer/assignments/:aid/decline` | reviews/routes | auth | refuseWhenAssignmentConferenceEnded | body:reviewerAssignmentActionSchema | json { message: 'Assignment declined.' } |
| 306 | POST | `/api/reviewer/assignments/:aid/conflict` | reviews/routes | auth | refuseWhenAssignmentConferenceEnded | body:reviewerAssignmentActionSchema | json { message: 'Conflict declared.' } |
| 307 | PUT | `/api/reviewer/assignments/:aid/review` | reviews/routes | auth | refuseWhenAssignmentConferenceEnded | body:saveReviewDraftSchema | json { message: 'Draft saved.' } |
| 308 | POST | `/api/reviewer/assignments/:aid/review/submit` | reviews/routes | auth | refuseWhenAssignmentConferenceEnded | body:submitReviewSchema | json { message: 'Review submitted.' } |
| 309 | POST | `/api/role-requests/:id/approve` | roleRequests/routes | auth |  |  | json { message: 'Request approved.' } |
| 310 | POST | `/api/role-requests/:id/reject` | roleRequests/routes | auth |  | body:rejectRoleRequestSchema | json { message: 'Request rejected.' } |
| 311 | GET | `/api/platform-settings` | platformSettings/routes | public |  |  | json { settings } |
| 312 | POST | `/api/suggestions` | suggestions/routes | public | suggestionIpRateLimit, suggestionDailyRateLimit | body:createSuggestionSchema | file/stream (text/csv; charset=utf-8); json { ok: true } |
| 313 | GET | `/api/me/agenda-conferences` | agenda/routes | auth |  |  | json { conferences: keepBoundConferenceRows(conferences, (c) => c.id) } |
| 314 | GET | `/api/conferences/:id/my-agenda` | agenda/routes | auth |  |  | json await getMyAgenda(req.params.id!, req.user!.id) |
| 315 | GET | `/api/conferences/:id/my-agenda.ics` | agenda/routes | auth |  |  | file/stream (text/calendar; charset=utf-8) |
| 316 | PUT | `/api/conferences/:id/my-agenda/:sessionId` | agenda/routes | auth |  |  | json { message: 'Added to your agenda.' } |
| 317 | DELETE | `/api/conferences/:id/my-agenda/:sessionId` | agenda/routes | auth |  |  | json { message: 'Removed from your agenda.' } |
| 318 | GET | `/api/conferences/:id/my-agenda-feed` | agenda/routes | auth |  |  | json await getFeedUrl(req.params.id!, req.user!.id) |
| 319 | POST | `/api/conferences/:id/my-agenda-feed/reset` | agenda/routes | auth |  |  | file/stream (text/calendar; charset=utf-8); json await resetFeedToken(req.params.id!, req.user!.id, auditContextFrom(re |
| 320 | GET | `/api/calendar/:token.ics` | agenda/routes | public |  |  | file/stream (text/calendar; charset=utf-8) |
| 321 | GET | `/api/me/feedback` | feedback/routes | auth |  |  | json { surveys: keepBoundConferenceRows(surveys, (s) => s.conference_id) } |
| 322 | GET | `/api/admin/conferences` | admin/routes | admin |  | query:listConferencesQuerySchema | json { conferences } |
| 323 | POST | `/api/admin/conferences` | admin/routes | admin |  | body:createConferenceSchema | json { id: result.id } [201] |
| 324 | GET | `/api/admin/conferences/:id/stats` | admin/routes | admin |  |  | json await getConferenceStats(req.params.id!) |
| 325 | POST | `/api/admin/conferences/:id/publish` | admin/routes | admin |  |  | json { message: 'Conference published.' } |
| 326 | POST | `/api/admin/conferences/:id/unpublish` | admin/routes | admin |  |  | json { message: 'Conference unpublished.' } |
| 327 | POST | `/api/admin/conferences/:id/view-as` | admin/routes | admin |  |  | json result |
| 328 | POST | `/api/admin/conferences/:id/convenor` | admin/routes | admin |  | body:appointConvenorSchema | json { message: 'Convenor appointed.' } |
| 329 | POST | `/api/admin/conferences/:id/convenor-invite` | admin/routes | admin | emailTriggerRateLimit | body:convenorInviteSchema | json result |
| 330 | GET | `/api/admin/users` | admin/routes | admin |  | query:listUsersQuerySchema | json await listUsers(req.query as never) |
| 331 | GET | `/api/admin/users/:id` | admin/routes | admin |  |  | json await getUserDetail(req.params.id!) |
| 332 | POST | `/api/admin/users/:id/suspend` | admin/routes | admin |  |  | json { message: 'User suspended.' } |
| 333 | POST | `/api/admin/users/:id/deactivate` | admin/routes | admin |  |  | json { message: 'User deactivated.' } |
| 334 | POST | `/api/admin/users/:id/reactivate` | admin/routes | admin |  |  | json { message: 'User reactivated.' } |
| 335 | POST | `/api/admin/users/:id/unlock` | admin/routes | admin |  |  | json { message: 'User unlocked.' } |
| 336 | POST | `/api/admin/users/:id/reset-password` | admin/routes | admin |  |  | json { message: 'A password reset link has been sent to this user.' } |
| 337 | POST | `/api/admin/users/:id/anonymize` | admin/routes | admin |  |  | json { message: 'User anonymised.' } |
| 338 | GET | `/api/admin/admins` | admin/routes | admin |  |  | json { admins: await listPlatformAdmins() } |
| 339 | POST | `/api/admin/admins` | admin/routes | super-admin |  | body:grantAdminSchema | json { message: 'Administrator access granted.' } |
| 340 | DELETE | `/api/admin/admins/:id` | admin/routes | super-admin |  |  | json { message: 'Administrator access removed.' } |
| 341 | POST | `/api/admin/admins/:id/super` | admin/routes | super-admin |  |  | json { message: 'Super administrator access granted.' } |
| 342 | DELETE | `/api/admin/admins/:id/super` | admin/routes | super-admin |  |  | json { message: 'Super administrator access removed.' } |
| 343 | POST | `/api/admin/conferences/:id/archive` | admin/routes | admin |  |  | json { message: 'Conference archived.' } |
| 344 | POST | `/api/admin/conferences/:id/restore` | admin/routes | admin |  |  | json { message: 'Conference restored.' } |
| 345 | GET | `/api/admin/dashboard` | admin/routes | admin |  |  | json await getDashboardCounts() |
| 346 | GET | `/api/admin/audit-log` | admin/routes | admin |  | query:auditLogQuerySchema | json await listAuditLog(req.query as never) |
| 347 | GET | `/api/admin/audit-log/export.csv` | admin/routes | admin |  | query:auditLogQuerySchema | file/stream (text/csv; charset=utf-8) |
| 348 | GET | `/api/admin/email-log` | emails/routes | admin |  | query:listEmailLogQuerySchema | json await listEmailLogForAdmin(req.query as never) |
| 349 | POST | `/api/admin/email-log/:id/retry` | emails/routes | admin |  |  | json { message: 'Email queued for another attempt.' } |
| 350 | GET | `/api/admin/platform-settings` | platformSettings/routes | admin |  |  | json { settings: await getPlatformSettings() } |
| 351 | PATCH | `/api/admin/platform-settings` | platformSettings/routes | super-admin |  | body:platformSettingsSchema | json { settings } |
| 352 | GET | `/api/admin/suggestions/export.csv` | suggestions/routes | admin |  | query:exportSuggestionsQuerySchema | file/stream (text/csv; charset=utf-8) |
| 353 | GET | `/api/admin/suggestions` | suggestions/routes | admin |  | query:listSuggestionsQuerySchema | json await listSuggestions(req.query as never) |
| 354 | GET | `/api/admin/suggestions/:id` | suggestions/routes | admin |  |  | json { suggestion } |
| 355 | PATCH | `/api/admin/suggestions/:id` | suggestions/routes | admin |  | body:updateSuggestionSchema | json { suggestion } |
| 356 | DELETE | `/api/admin/suggestions/:id` | suggestions/routes | admin |  |  | json { message: 'Suggestion deleted.' } |
| 357 | GET | `/api/me/profile` | me/routes | auth |  |  | json { user: await getMyProfile(req.user!.id) } |
| 358 | PATCH | `/api/me/profile` | me/routes | auth |  | body:updateMyProfileSchema | json { user: await getMyProfile(req.user!.id) } |
| 359 | POST | `/api/me/photo` | me/routes | auth | uploadRateLimit, imageUpload(PHOTO_MAX_BYTES) |  | json { path: relativePath } |
| 360 | DELETE | `/api/me/photo` | me/routes | auth |  |  | json { message: 'Removed.' } |
| 361 | GET | `/api/me/notifications` | me/routes | auth |  |  | json { notifications: await listMyNotifications(req.user!.id, unreadOnly) } |
| 362 | POST | `/api/me/notifications/:id/read` | me/routes | auth |  |  | json { message: 'Marked read.' } |
| 363 | POST | `/api/me/notifications/read-all` | me/routes | auth |  |  | json { message: 'All notifications marked read.' } |
| 364 | GET | `/api/me/chair-sessions` | me/routes | auth |  |  | json { sessions: keepBoundConferenceRows(sessions, (s) => s.conference_id)  |
| 365 | GET | `/api/me/certificates` | me/routes | auth |  |  | json { certificates: keepBoundConferenceRows(certificates, (c) => c.confere |
| 366 | GET | `/api/announcements/public` | announcements/routes | public |  |  | json { announcements: rows } |
