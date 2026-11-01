# Database updates: 1 November 2026

**This folder is everything you still need to run.** Ignore `batch-3-sql/` and
`06_session_conference.sql`: they're already inside these files.

It adds:

| Feature | What it creates |
|---|---|
| My agenda + calendar | `agenda_items`, `agenda_feed_tokens` |
| Session timer | new timer columns on `conference_settings` |
| Book of abstracts | `abstract_books` |
| Feedback survey | `feedback_*` tables + `feedback_invitation` email |
| Per-conference sign-in | `auth_sessions.conference_id` |

Every file is **safe to run more than once**. It only adds what's missing and
never deletes data.

---

## Step 1: your computer (2 minutes)

1. Open **MySQL Workbench** and connect to your local server as `root`.
2. **File → Open SQL Script** → `1-LOCAL-run-this.sql`
3. Click the **lightning icon** (run everything).
4. The last result should say: `Done - local and test databases are up to date`.

This updates both `conference_cms` and `conference_cms_test`.

## Step 2: Aiven (the live database)

1. In Workbench, connect to your **Aiven** connection (see `docs/aiven-mysql-setup.md`).
2. **File → Open SQL Script** → `2-AIVEN-run-this.sql`
3. Click the **lightning icon**.
4. The last result should say: `Done - Aiven database is up to date`.

> Do Step 2 **before** you merge `features-nov` into `main`. The new sign-in
> code needs `auth_sessions.conference_id`, so if the live server gets the code
> first, nobody can sign in.

## Step 3: check it worked

Open `3-CHECK.sql` and run it on each connection. **Every row must say `OK`.**
To check the test database, change its first line to `USE conference_cms_test;`.

## Step 4: tell Claude it's done

After that, the server tests and the Playwright tests can run, and
`features-nov` can be merged into `main`.

---

*Note: existing sign-ins are logged out once (they have no conference yet), and
people just sign in again at their conference's page. This is expected.*

*To rebuild the RUN files after changing a source file: `sh build.sh`.*
