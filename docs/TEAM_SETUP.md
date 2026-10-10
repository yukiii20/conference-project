# Team setup (Windows)

Follow these steps in order. They get the app running on your own laptop.
Each laptop has **its own MySQL database** — nobody shares data, so you
cannot "break" anyone else's setup and your test data is only yours.

## 1. Install the tools

1. **Node.js 20 or newer** — download from https://nodejs.org (the "LTS"
   installer) and run it with default options.
2. **MySQL 8** — download "MySQL Installer" from
   https://dev.mysql.com/downloads/installer/ and choose the
   **"Developer Default"** setup. This also installs **MySQL Workbench**,
   which you'll use to run the `.sql` files below.
   - Do **not** use XAMPP — it ships MariaDB, which this project's
     database does not work with.
   - When the installer asks you to set a root password, pick something
     you'll remember — you'll use it in the next step.

## 2. Get the code

```bash
git clone <the repo URL>
cd "conference project"
```

## 3. Create the database

Open **MySQL Workbench**, connect with the root account you set up, then
for each file below: **File → Open SQL Script**, open the file, click the
lightning-bolt "run" icon. Run them **in this exact order**:

1. `database/01_schema.sql`
2. `database/02_reference_data.sql`
3. `database/03_triggers.sql`
4. every `database/04_*.sql` file, in filename order (there may be more
   than one — run all of them)
5. `database/test-setup.sql` (creates a second, separate database just for
   automated tests, so tests never touch your real data)

If you prefer the command line instead of Workbench:

```bash
mysql -u root -p < database/01_schema.sql
mysql -u root -p < database/02_reference_data.sql
mysql -u root -p < database/03_triggers.sql
mysql -u root -p < database/04_admin_extensions.sql
mysql -u root -p < database/test-setup.sql
```

## 4. Create the app's database user

The server never connects as root. In the same Workbench window, run:

```sql
CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<pick a strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.* TO 'cms_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms_test.* TO 'cms_app'@'localhost';
FLUSH PRIVILEGES;
```

Remember the password you pick — you'll put it in `server/.env` next.

## 5. Configure the backend

```bash
cd server
copy .env.example .env
```

Open `server/.env` in a text editor and fill in:

- `DB_PASSWORD` — the password you set for `cms_app` above.
- `SESSION_SECRET` — generate one by running this in a terminal and
  pasting the output:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Leave everything else as-is for now (`EMAIL_MODE=console` means emails
  print to the backend terminal instead of actually sending — that's fine
  for local development).

## 6. Install packages

From the repo root:

```bash
npm install
cd server
npm install
```

## 7. Create your admin account

Still inside `server/`:

```bash
npm run create-admin
```

Answer the prompts (email, name, password). This is your personal login
for `/super-admin/login` on your own machine.

## 8. Run it

Easiest: double-click **`start.bat`** in the repo root (or run it from a
terminal). It opens the backend and frontend in two windows and then opens
the browser for you.

Or manually, in two separate terminals:

```bash
cd server
npm run dev
```

```bash
npm run dev
```

Then open http://localhost:5173.

## 9. Something not working?

From `server/`, run:

```bash
npm run doctor
```

It checks your `.env`, your MySQL connection, and whether all the tables
exist, and tells you what's wrong (without printing any passwords).

### Common errors

- **"Invalid environment configuration"** when starting the backend — your
  `server/.env` is missing or missing a required variable. Re-check step 5.
- **`EADDRINUSE` on port 4000** — the backend is already running (maybe in
  another window). Close the other window, or stop the process using
  port 4000.
- **`ECONNREFUSED`** (from the frontend, when calling the API) — the
  backend isn't running. Start it (step 8).
- **"Access denied for user 'cms_app'"** — the password in `server/.env`
  doesn't match the password you set for the `cms_app` MySQL user in
  step 4. Re-set one to match the other.
