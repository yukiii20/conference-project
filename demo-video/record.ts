// Records the product video's scenes against the throwaway :5273/:4100 dev
// servers (never the real dev servers, never conference_cms). One Chromium
// video file per scene, via Playwright (resolved from the repo root's own
// node_modules - demo-video/ stays self-contained for everything else, but
// Playwright + its already-downloaded chromium browser are shared, not
// duplicated).
//
// Usage (from the repo root):
//   npx tsx demo-video/record.ts            # records every scene
//   npx tsx demo-video/record.ts --scene 10  # re-records just scene 10
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { chromium, type Locator, type Page } from 'playwright'
import { DEMO } from './demo-seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../server/.env') })

const BASE_URL = 'http://localhost:5273'
const RAW_DIR = path.join(__dirname, 'work/raw')
const CHECK_DIR = path.join(__dirname, 'work/check')

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'conference_cms_test',
    waitForConnections: true,
    connectionLimit: 2,
  })
}

// ---------------------------------------------------------------------------
// "Human feel" helpers
// ---------------------------------------------------------------------------

const CURSOR_INIT_SCRIPT = `
(() => {
  const dot = document.createElement('div');
  const ring = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed', zIndex: 2147483647, width: '10px', height: '10px',
    borderRadius: '50%', background: '#2a2a2a', pointerEvents: 'none',
    left: '-100px', top: '-100px', transition: 'left 0.08s linear, top 0.08s linear',
  });
  Object.assign(ring.style, {
    position: 'fixed', zIndex: 2147483646, width: '26px', height: '26px',
    marginLeft: '-8px', marginTop: '-8px', borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
    pointerEvents: 'none', left: '-100px', top: '-100px',
    transition: 'left 0.08s linear, top 0.08s linear',
  });
  function place() {
    if (!document.body) { requestAnimationFrame(place); return; }
    document.body.appendChild(dot);
    document.body.appendChild(ring);
  }
  place();
  window.addEventListener('mousemove', (e) => {
    dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px';
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
  }, { passive: true });
  window.__clickRipple = (x, y) => {
    const r = document.createElement('div');
    Object.assign(r.style, {
      position: 'fixed', zIndex: 2147483645, left: x + 'px', top: y + 'px',
      width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
      borderRadius: '50%', border: '2px solid #722F37', pointerEvents: 'none',
      transition: 'width 0.35s ease-out, height 0.35s ease-out, margin 0.35s ease-out, opacity 0.35s ease-out',
      opacity: '0.9',
    });
    document.body.appendChild(r);
    requestAnimationFrame(() => {
      r.style.width = '46px'; r.style.height = '46px';
      r.style.marginLeft = '-23px'; r.style.marginTop = '-23px'; r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 400);
  };
})();
`

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pause(min = 800, max = 1500): Promise<void> {
  return wait(min + Math.random() * (max - min))
}

/** Real eased mouse movement (Playwright's own intermediate steps) + a click ripple + the actual click. */
async function humanClick(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) {
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y, { steps: 18 })
    await pause(150, 350)
    await page.evaluate(([px, py]) => (window as unknown as { __clickRipple: (x: number, y: number) => void }).__clickRipple(px, py), [x, y] as [number, number])
  }
  await locator.click()
}

/** Polls until a button is no longer disabled (e.g. an upload button gated on an async can-upload check after a draft save). */
async function expectEnabled(locator: Locator, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return
    await wait(200)
  }
  throw new Error('Timed out waiting for element to become enabled.')
}

/** Real per-key typing, ~60ms/key. */
async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  await locator.click()
  await locator.pressSequentially(text, { delay: 60 })
}

async function humanSelect(page: Page, locator: Locator, label: string): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  await locator.scrollIntoViewIfNeeded()
  await locator.selectOption({ label })
  await pause(300, 600)
}

/** Smooth scroll (not an instant jump) to an element or a page position. */
async function smoothScrollTo(page: Page, target: Locator | number): Promise<void> {
  if (typeof target === 'number') {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), target)
  } else {
    await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  await wait(900)
}

/** Small cream/burgundy callout label near an element, visible for ~2s. */
async function showCallout(page: Page, locator: Locator, text: string, durationMs = 2000): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) return
  await page.evaluate(
    ([x, y, label]) => {
      const el = document.createElement('div')
      el.textContent = label as string
      Object.assign(el.style, {
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: '2147483647',
        background: '#E8DCC6',
        color: '#722F37',
        fontWeight: '700',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: '18px',
        padding: '8px 16px',
        borderRadius: '999px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        opacity: '0',
        transform: 'translateY(8px)',
        transition: 'opacity 0.25s ease-out, transform 0.25s ease-out',
      })
      el.id = '__callout'
      document.body.appendChild(el)
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        el.style.transform = 'translateY(0)'
      })
    },
    [box.x + box.width + 16, Math.max(8, box.y - 8), text] as [number, number, string],
  )
  await wait(durationMs)
  await page.evaluate(() => document.getElementById('__callout')?.remove())
}

// ---------------------------------------------------------------------------
// App-specific helpers
// ---------------------------------------------------------------------------

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`)
  await humanType(page.locator('#si-email'), email)
  await pause()
  await humanType(page.locator('#si-password'), DEMO.password)
  await pause()
  await humanSelect(page, page.locator('#si-role'), labelForRole(role))
  await pause()
  // react-router navigates client-side (no real page load), so poll the URL
  // rather than trust waitForLoadState('networkidle') to mean "navigated" -
  // and only retry the click while still actually on the login page (a slow
  // but successful first click must never get a stray second submit).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!page.url().includes('/login')) return
    await humanClick(page, page.getByRole('button', { name: 'Sign in' }))
    const navigated = await page
      .waitForURL((url) => !url.pathname.includes('/login'), { timeout: 6000 })
      .then(() => true)
      .catch(() => false)
    if (navigated) {
      await page.waitForLoadState('networkidle')
      return
    }
  }
  throw new Error(`Login did not navigate away from /login after 3 attempts (email=${email})`)
}

function labelForRole(role: string): string {
  const labels: Record<string, string> = {
    author: 'Author',
    reviewer: 'Reviewer',
    session_chair: 'Session Chair',
    staff: 'Staff',
    manager: 'Manager',
    convenor: 'Convenor',
  }
  return labels[role] ?? role
}

async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/super-admin/login`)
  await humanType(page.locator('#sa-email'), DEMO.adminEmail)
  await pause()
  await humanType(page.locator('#sa-password'), DEMO.password)
  await pause()
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!page.url().includes('/super-admin/login')) return
    await humanClick(page, page.getByRole('button', { name: 'Sign in' }))
    const navigated = await page
      .waitForURL((url) => !url.pathname.includes('/super-admin/login'), { timeout: 6000 })
      .then(() => true)
      .catch(() => false)
    if (navigated) {
      await page.waitForLoadState('networkidle')
      return
    }
  }
  throw new Error('Admin login did not navigate away from /super-admin/login after 3 attempts')
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

type SceneFn = (page: Page) => Promise<void>

function animatedScene(file: string, durationMs: number): SceneFn {
  return async (page: Page) => {
    await page.goto(`file://${path.join(__dirname, 'animations', file)}`)
    await wait(durationMs)
  }
}

const scene2: SceneFn = async (page) => {
  await page.goto(`${BASE_URL}/`)
  await page.waitForLoadState('networkidle')
  await pause()
  await smoothScrollTo(page, 650)
  await pause()
  const link = page.locator(`a[href="/c/${DEMO.conferenceSlug}"]`).first()
  await humanClick(page, link)
  await page.waitForLoadState('networkidle')
  await pause(1200, 1800)
}

const scene4: SceneFn = async (page) => {
  await login(page, DEMO.authorEmail, 'author')
  await page.goto(`${BASE_URL}/portal/author?conference=${DEMO.conferenceSlug}`)
  await page.waitForLoadState('networkidle')
  await humanClick(page, page.getByRole('tab', { name: 'New abstract' }))
  await pause()
  await humanSelect(page, page.locator('#submission-track'), DEMO.trackNames[0]!)
  await pause()
  await humanType(page.locator('#submission-title'), 'Hardening IoT Gateways Against Supply-Chain Attacks')
  await pause()
  await humanType(
    page.locator('#submission-abstract'),
    'We present a lightweight attestation scheme for IoT gateway firmware that detects tampered supply-chain components before they reach production, with minimal boot-time overhead.',
  )
  await pause()
  // At least one keyword is required to save a draft at all.
  const keywordInput = page.getByPlaceholder('Add a keyword and press Enter')
  await humanType(keywordInput, 'IoT security')
  await humanClick(page, page.getByRole('button', { name: 'Add' }))
  await pause()

  await humanClick(page, page.getByRole('button', { name: 'Create draft' }))
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)

  const fileInputButton = page.getByRole('button', { name: 'Upload abstract file' })
  await fileInputButton.waitFor({ state: 'visible' })
  await expectEnabled(fileInputButton)
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), fileInputButton.click()])
  await fileChooser.setFiles(path.join(__dirname, 'assets/demo-abstract.pdf'))
  await page.waitForLoadState('networkidle')
  await pause(1000, 1500)

  await humanClick(page, page.getByRole('button', { name: 'Submit for review' }))
  await pause()
  await humanClick(page, page.getByRole('button', { name: 'Submit for review' }).last())
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene5: SceneFn = async (page) => {
  await login(page, DEMO.reviewerEmail, 'reviewer')
  await page.goto(`${BASE_URL}/portal/reviewer?conference=${DEMO.conferenceSlug}`)
  await page.waitForLoadState('networkidle')
  const row = page.locator('li', { hasText: DEMO.underReviewPaperTitle }).first()
  await showCallout(page, row, 'Blind review')
  // The assignment starts 'assigned' (awaiting response) - accept it first,
  // which is what turns the row's action into "Write review".
  await humanClick(page, row.getByRole('button', { name: 'Accept' }))
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  await humanClick(page, row.getByRole('button', { name: 'Write review' }))
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)

  await humanType(
    page.locator('textarea').first(),
    'The methodology is sound and the adversarial evaluation is thorough. Minor revision to clarify the threat model would strengthen the paper.',
  )
  await pause()
  await humanClick(page, page.getByRole('button', { name: 'Submit review' }))
  await pause()
  const confirmBtn = page.getByRole('button', { name: 'Submit review' }).last()
  await humanClick(page, confirmBtn)
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene6: SceneFn = async (page) => {
  await login(page, DEMO.convenorEmail, 'convenor')
  await page.goto(`${BASE_URL}/convenor/dashboard`)
  await page.waitForLoadState('networkidle')
  await pause(1200, 1600)
  await page.goto(`${BASE_URL}/convenor/papers/submissions`)
  await page.waitForLoadState('networkidle')
  const row = page.locator('tr', { hasText: DEMO.readyToDecidePaperTitle }).first()
  await humanClick(page, row)
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  await smoothScrollTo(page, page.getByRole('button', { name: 'Save decision' }))
  await humanType(
    page.locator('textarea').last(),
    'Great contribution with a clear, reproducible methodology. Accepted - looking forward to the presentation.',
  )
  await pause()
  await humanClick(page, page.getByRole('button', { name: 'Save decision' }))
  await pause()
  await humanClick(page, page.getByRole('button', { name: 'Save decision' }).last())
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene7: SceneFn = async (page) => {
  await login(page, DEMO.convenorEmail, 'convenor')
  await page.goto(`${BASE_URL}/convenor/event/programme`)
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  const sessionRow = page.locator('tr', { hasText: 'Cyber Security Research Papers I' }).first()
  await humanClick(page, sessionRow.getByRole('button', { name: 'Manage' }))
  await pause(800, 1200)

  const dialog = page.getByRole('dialog')
  const addPaperHeading = dialog.getByText('Add an accepted paper')
  await addPaperHeading.waitFor({ state: 'visible' })
  // No submission_code was seeded (NULL), so the option's accessible label
  // is just the title. Scoped to the "Add an accepted paper" card (not
  // page.locator('select').filter({hasText}), which was matching zero
  // elements against this particular React Select re-render).
  const paperCard = addPaperHeading.locator('xpath=ancestor::div[contains(@class,"border-dashed")][1]')
  const paperSelect = paperCard.locator('select')
  await paperSelect.waitFor({ state: 'visible' })
  await paperSelect.scrollIntoViewIfNeeded()
  // The paper list loads async after the dialog opens - wait for the real
  // option to actually exist, not just a fixed pause.
  await paperSelect.locator('option', { hasText: DEMO.readyToDecidePaperTitle }).waitFor({ state: 'attached' })
  await pause(300, 500)
  await paperSelect.selectOption({ label: DEMO.readyToDecidePaperTitle })
  await pause()
  await humanClick(page, paperCard.getByRole('button', { name: 'Add' }))
  await page.waitForLoadState('networkidle')
  await pause(1200, 1600)

  // Confirm it on the public programme.
  await page.goto(`${BASE_URL}/c/${DEMO.conferenceSlug}`)
  await page.waitForLoadState('networkidle')
  const programmeTabBtn = page.getByRole('button', { name: /programme/i }).or(page.getByRole('link', { name: /programme/i }))
  if (await programmeTabBtn.first().isVisible().catch(() => false)) {
    await humanClick(page, programmeTabBtn.first())
  }
  await pause(1500, 2000)
}

const scene9: SceneFn = async (page) => {
  await login(page, DEMO.attendeeEmail, 'author')
  await page.goto(`${BASE_URL}/portal/ticket?conference=${DEMO.conferenceSlug}`)
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  const categorySelect = page.locator('select').filter({ hasText: 'General Attendee' })
  await humanSelect(page, categorySelect, 'General Attendee')
  await pause()
  await humanClick(page, page.getByRole('button', { name: 'Register to attend' }))
  await page.waitForLoadState('networkidle')
  await pause(1500, 2200)
}

const scene10: SceneFn = async (page) => {
  await login(page, DEMO.staffEmail, 'staff')
  await page.goto(`${BASE_URL}/portal/staff?conference=${DEMO.conferenceSlug}`)
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  const searchInput = page.getByPlaceholder('Name, email or registration number')
  await humanType(searchInput, 'Demo Attendee')
  await page.waitForTimeout(900) // debounce
  await pause(600, 1000)
  const resultRow = page.locator('li, tr', { hasText: 'Demo Attendee' }).first()
  await humanClick(page, resultRow.getByRole('button', { name: 'Check in' }))
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene12: SceneFn = async (page) => {
  await login(page, DEMO.convenorEmail, 'convenor')
  await page.goto(`${BASE_URL}/convenor/event/certificates`)
  await page.waitForLoadState('networkidle')
  await pause(1000, 1400)
  await smoothScrollTo(page, page.getByRole('button', { name: 'Generate certificates' }))
  await humanClick(page, page.getByRole('button', { name: 'Generate certificates' }))
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
  await humanClick(page, page.getByRole('button', { name: 'Release now' }))
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene13: SceneFn = async (page) => {
  await login(page, DEMO.attendeeEmail, 'author')
  await page.goto(`${BASE_URL}/portal/certificates`)
  await page.waitForLoadState('networkidle')
  await pause(1200, 1600)
  const downloadLink = page.getByRole('link', { name: 'Download PDF' }).first()
  await downloadLink.waitFor({ state: 'visible' })
  await downloadLink.scrollIntoViewIfNeeded()
  const [newPage] = await Promise.all([page.context().waitForEvent('page'), humanClick(page, downloadLink)])
  await newPage.waitForLoadState('load').catch(() => {})
  await wait(3000)
}

const scene14: SceneFn = async (page) => {
  const p = pool()
  const [rows] = await p.query(
    `SELECT c.verification_token FROM certificates c
     JOIN conferences conf ON conf.id = c.conference_id
     JOIN users u ON u.id = c.recipient_user_id
     WHERE conf.slug = ? AND u.email = ? AND c.status = 'issued'
     ORDER BY c.issued_at DESC LIMIT 1`,
    [DEMO.conferenceSlug, DEMO.attendeeEmail],
  )
  const token = (rows as Array<{ verification_token: string }>)[0]?.verification_token
  if (!token) {
    await p.end()
    throw new Error('No issued certificate found for demo-attendee - did scene 12 run first?')
  }

  await page.goto(`${BASE_URL}/verify/${token}`)
  await page.waitForLoadState('networkidle')
  await showCallout(page, page.locator('h1'), 'Tamper-proof QR')
  await pause(1500, 2000)

  // Convenor revokes it.
  const convenorPage = await page.context().newPage()
  await login(convenorPage, DEMO.convenorEmail, 'convenor')
  await convenorPage.goto(`${BASE_URL}/convenor/event/certificates`)
  await convenorPage.waitForLoadState('networkidle')
  await pause(1000, 1400)
  const row = convenorPage.locator('tr', { hasText: 'Demo Attendee' }).first()
  await row.scrollIntoViewIfNeeded()
  convenorPage.once('dialog', (dialog) => dialog.accept('Demo revocation for the product video.'))
  await humanClick(convenorPage, row.getByRole('button', { name: 'Revoke' }))
  await convenorPage.waitForLoadState('networkidle')
  await pause(1200, 1600)
  await convenorPage.close()

  await p.end()

  // Back on the verify page: reload to show "Revoked".
  await page.reload()
  await page.waitForLoadState('networkidle')
  await pause(1500, 2000)
}

const scene15: SceneFn = async (page) => {
  await adminLogin(page)
  await page.waitForLoadState('networkidle')
  await pause(1500, 2500)
}

const SCENES: Array<{ num: number; name: string; fn: SceneFn }> = [
  { num: 1, name: '01-intro', fn: animatedScene('01-intro.html', 5000) },
  { num: 2, name: '02-home-conference', fn: scene2 },
  { num: 3, name: '03-submit-review', fn: animatedScene('03-submit-review.html', 3000) },
  { num: 4, name: '04-author-submits', fn: scene4 },
  { num: 5, name: '05-reviewer-reviews', fn: scene5 },
  { num: 6, name: '06-convenor-accepts', fn: scene6 },
  { num: 7, name: '07-programme-schedule', fn: scene7 },
  { num: 8, name: '08-register-checkin', fn: animatedScene('08-register-checkin.html', 3000) },
  { num: 9, name: '09-attendee-registers', fn: scene9 },
  { num: 10, name: '10-staff-checkin', fn: scene10 },
  { num: 11, name: '11-certificates', fn: animatedScene('11-certificates.html', 3000) },
  { num: 12, name: '12-generate-certs', fn: scene12 },
  { num: 13, name: '13-download-cert', fn: scene13 },
  { num: 14, name: '14-verify-revoke', fn: scene14 },
  { num: 15, name: '15-super-admin', fn: scene15 },
  { num: 16, name: '16-outro', fn: animatedScene('16-outro.html', 5000) },
]

async function main() {
  const args = process.argv.slice(2)
  const sceneArgIdx = args.indexOf('--scene')
  const onlyScene = sceneArgIdx >= 0 ? Number(args[sceneArgIdx + 1]) : null

  await mkdir(RAW_DIR, { recursive: true })
  await mkdir(CHECK_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const results: Array<{ num: number; name: string; ok: boolean; error?: string }> = []

  for (const scene of SCENES) {
    if (onlyScene !== null && scene.num !== onlyScene) continue
    console.log(`\n--- Scene ${scene.num}: ${scene.name} ---`)
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    await context.addInitScript(CURSOR_INIT_SCRIPT)
    const page = await context.newPage()
    if (process.env.DEBUG_RECORD) {
      page.on('response', (res) => {
        if (res.url().includes('/api/')) console.log('  [resp]', res.status(), res.url())
      })
      page.on('pageerror', (err) => console.log('  [pageerror]', err.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.log('  [console.error]', msg.text())
      })
    }
    try {
      await scene.fn(page)
      await page.screenshot({ path: path.join(CHECK_DIR, `${scene.name}.png`) })
      results.push({ num: scene.num, name: scene.name, ok: true })
      console.log(`  OK`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  FAILED: ${message}`)
      try {
        await page.screenshot({ path: path.join(CHECK_DIR, `${scene.name}.FAILED.png`) })
      } catch {
        /* page may already be unusable */
      }
      results.push({ num: scene.num, name: scene.name, ok: false, error: message })
    } finally {
      await page.close().catch(() => {})
      const video = page.video()
      await context.close()
      if (video) {
        try {
          const rawPath = await video.path()
          const destPath = path.join(RAW_DIR, `${scene.name}.webm`)
          await rm(destPath, { force: true })
          await rename(rawPath, destPath)
        } catch (err) {
          console.error(`  Could not save video for scene ${scene.num}:`, err)
        }
      }
    }
  }

  await browser.close()

  console.log('\n=== Recording summary ===')
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  scene ${r.num} (${r.name})${r.error ? ' - ' + r.error : ''}`)
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} scene(s) failed.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Recording failed:', err)
  process.exit(1)
})
