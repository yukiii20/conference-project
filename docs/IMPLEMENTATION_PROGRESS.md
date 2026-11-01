# Implementation progress

One entry per phase of `REFACTORING_PLAN.md`. A feature is only reported as done with evidence
(tests run, output inspected), never just because its interface exists.

---

## Phase 0 — Full audit · 1 November 2026 · status: DONE, waiting for approval

**Work completed**
- Read the whole repository and traced the main workflows from the UI through the API to the
  database.
- Walked the import graph for dead files, checked every dependency was used, and scanned all
  273 API routes for auth guards.
- Scanned for SQL-injection patterns, upload and download access, timezone bugs, the email
  lifecycle, background jobs, design tokens, and repository size.

**Files created** (documentation only — no code changed in this phase)
- `docs/PROJECT_AUDIT.md`
- `docs/FEATURE_COMPLETION_MATRIX.md`
- `docs/ARCHITECTURE.md`
- `docs/REFACTORING_PLAN.md`
- `docs/IMPLEMENTATION_PROGRESS.md`

**Files removed:** none.

**Bugs discovered** (details in the audit)
- **C1:** production uploads are wiped on each Render deploy.
- **C2:** Aiven SQL status unconfirmed.
- **H1:** reviewer downloads keep the author's filename and PDF metadata.
- **H2:** scheduled jobs pause while Render sleeps.
- **H3:** registration categories, fees and payments exist as tables only.
- **H4:** no ESLint.
- **M1–M8 and L1–L6:** listed in the audit.

**Bugs fixed:** none in this phase. It's audit-only by design.

**Tests executed in this phase**

| Check | Result |
|---|---|
| `tsc` frontend | pass |
| `tsc` server | pass |
| `vite build` | pass |
| Frontend Vitest | 75/75 pass |
| Server Vitest without a database | 308 pass; 366 not runnable (`ECONNREFUSED` — no MySQL on this machine) |
| Playwright, k6, Lighthouse | not run (they need a database or a deployed site) |

**Remaining issues:** everything in the audit, plus decisions D1–D7 in the plan.

**Next phase:** Phase 1 (critical fixes), after the owner answers D1–D7.

---

## Before Phase 0 (same day, for the record)

These were already pushed to `main` earlier on 1 November. Details are in `docs/progress.md`.

- UI spacing fixes and slim scrollbars.
- Certificate redesign, then the fully editable certificate template with live preview.
- Email `{{conference_code}}` placeholder fix.
- Portal chunk prefetch.
- `npm audit fix`: frontend now clean; the server's remaining 9 moderate issues are all
  inside `exceljs`.
- Dated SQL run folder `database/2026-11-01/`.
- Stray zip files removed from the working tree.
