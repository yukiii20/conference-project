// Captures the still screenshots used by the home page "The platform" showcase
// (public/images/product/*.webp) from the throwaway :5273/:4100 servers, using
// the demo-seed.ts data only. Same setup as record.ts (see README.md).
//
// Usage (from the repo root):
//   npx tsx demo-video/screens.ts                 # every screen
//   npx tsx demo-video/screens.ts manage review   # just these ids
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { chromium, type Page } from 'playwright'
import { DEMO } from './demo-seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'http://localhost:5273'
const OUT_DIR = path.join(__dirname, '../public/images/product')
const RAW_DIR = path.join(__dirname, 'work/screens')

// Matches the showcase frame's 16:10.5 window, so nothing is cropped away.
const VIEWPORT = { width: 1280, height: 840 }
const OUTPUT_WIDTH = 1600

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto(`${BASE_URL}/c/${DEMO.conferenceSlug}/login`)
  await page.locator('#si-email').fill(email)
  await page.locator('#si-password').fill(DEMO.password)
  await page.locator('#si-role').selectOption({ label: role })
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/super-admin/login`)
  await page.locator('#sa-email').fill(DEMO.adminEmail)
  await page.locator('#sa-password').fill(DEMO.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/super-admin/login'), { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

// Puts a section heading near the top of the window (the main area scrolls, not the window).
async function scrollToHeading(page: Page, name: string): Promise<void> {
  const heading = page.getByRole('heading', { name, exact: true }).first()
  await heading.waitFor({ state: 'visible' })
  await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.mouse.move(800, 500)
  await page.mouse.wheel(0, -130)
  await page.waitForTimeout(400)
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(`${BASE_URL}${url}`)
  await page.waitForLoadState('networkidle')
}

type Screen = { id: string; file: string; run: (page: Page) => Promise<void> }

const SCREENS: Screen[] = [
  {
    id: 'manage',
    file: 'convenor-dashboard',
    run: async (page) => {
      await login(page, DEMO.convenorEmail, 'Convenor')
      await open(page, '/convenor/dashboard')
    },
  },
  {
    id: 'submit',
    file: 'submission',
    run: async (page) => {
      await login(page, DEMO.authorEmail, 'Author')
      await open(page, `/portal/author?conference=${DEMO.conferenceSlug}`)
      await page.getByRole('tab', { name: 'New abstract' }).click()
      await page.locator('#submission-track').selectOption({ label: DEMO.trackNames[0]! })
      await page.locator('#submission-title').fill('Hardening IoT Gateways Against Supply-Chain Attacks')
      await page
        .locator('#submission-abstract')
        .fill(
          'We present a lightweight attestation scheme for IoT gateway firmware that detects tampered supply-chain components before they reach production, with minimal boot-time overhead.',
        )
    },
  },
  {
    id: 'review',
    file: 'review',
    run: async (page) => {
      await login(page, DEMO.reviewerEmail, 'Reviewer')
      await open(page, `/portal/reviewer?conference=${DEMO.conferenceSlug}`)
    },
  },
  {
    id: 'programme',
    file: 'programme',
    run: async (page) => {
      await login(page, DEMO.convenorEmail, 'Convenor')
      await open(page, '/convenor/event/programme')
      await scrollToHeading(page, 'Sessions')
    },
  },
  {
    id: 'checkin',
    file: 'checkin',
    run: async (page) => {
      await login(page, DEMO.staffEmail, 'Staff')
      await open(page, `/portal/staff?conference=${DEMO.conferenceSlug}`)
    },
  },
  {
    id: 'certificates',
    file: 'certificates',
    run: async (page) => {
      await login(page, DEMO.convenorEmail, 'Convenor')
      await open(page, '/convenor/event/certificates')
      // The template preview is a PDF iframe, which headless Chromium leaves blank - show issued certificates instead.
      const generate = page.getByRole('button', { name: 'Generate certificates' })
      const issued = page.getByRole('heading', { name: 'Issued certificates', exact: true })
      if (await page.getByText('No certificates issued yet.').isVisible().catch(() => false)) {
        await generate.click()
        await page.waitForLoadState('networkidle')
        await page.getByRole('button', { name: 'Release now' }).click()
        await page.waitForLoadState('networkidle')
      }
      await issued.waitFor({ state: 'visible' })
      await scrollToHeading(page, 'Issued certificates')
    },
  },
  {
    id: 'analytics',
    file: 'admin',
    run: async (page) => {
      await adminLogin(page)
    },
  },
]

async function main() {
  const only = process.argv.slice(2)
  await mkdir(RAW_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  for (const screen of SCREENS) {
    if (only.length && !only.includes(screen.id)) continue
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await screen.run(page)
      await page.waitForTimeout(2500)
      const raw = path.join(RAW_DIR, `${screen.file}.png`)
      await page.screenshot({ path: raw })
      await sharp(raw).resize({ width: OUTPUT_WIDTH }).webp({ quality: 82 }).toFile(path.join(OUT_DIR, `${screen.file}.webp`))
      console.log(`ok   ${screen.id} -> ${screen.file}.webp`)
    } catch (err) {
      console.log(`FAIL ${screen.id}: ${(err as Error).message.split('\n')[0]}`)
    } finally {
      await context.close()
    }
  }
  await browser.close()
}

void main()
