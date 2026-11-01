# Database update: 1 November 2026 (part 2)

Run this **after** `../2026-11-01/` (part 1). It adds one thing:

| Feature | What it creates |
|---|---|
| Super administrator | one row in `roles` (`super_admin`). No table changes. |

It's safe to run more than once. Running it late doesn't break anything either: until this role
exists, every admin simply keeps full rights (the old behaviour).

1. **Your computer:** in MySQL Workbench, open `1-LOCAL-run-this.sql` and run it. The last row
   should say `Done - local and test databases are up to date`.
2. **Aiven:** connect to Aiven, open `2-AIVEN-run-this.sql` and run it. The last row should say
   `Done - Aiven database is up to date`.
3. **Check:** run `3-CHECK.sql` on each connection. It must say `OK`.
4. **In the app:** go to Super admin → Administrators and click **Make super admin** for the
   people who should manage admins and platform settings. The first time, you're made one
   automatically too.
