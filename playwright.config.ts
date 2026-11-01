import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Deliberately NOT 4000/5173 (the user's real dev servers) — see
// e2e/README or docs/test-report.md for how these are started.
export const E2E_BASE_URL = 'http://localhost:5273'

// Some machines' Application Control / AppLocker policy blocks the separate
// chrome-headless-shell.exe Playwright normally launches for headless runs,
// while still allowing the full chrome.exe. If that shell binary is missing
// or blocked, fall back to the full browser (still headless) instead of
// failing every test with "spawn UNKNOWN". Harmless no-op on a machine
// where the default headless shell works fine.
// Set PLAYWRIGHT_CHROMIUM_PATH to force a specific browser; otherwise use the newest
// Playwright-installed full chromium for the current Windows user, if there is one.
function chromiumExecutablePathOverride(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH
  if (explicit) return existsSync(explicit) ? explicit : undefined
  if (!process.env.LOCALAPPDATA) return undefined
  const root = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  if (!existsSync(root)) return undefined
  const buildNumber = (d: string) => Number(d.slice('chromium-'.length)) || 0
  const builds = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort((a, b) => buildNumber(b) - buildNumber(a))
  for (const build of builds) {
    const candidate = path.join(root, build, 'chrome-win64', 'chrome.exe')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  // One retry: a test that only fails under load in the long full-suite run is reported as
  // "flaky" instead of failing the run; a real bug still fails both attempts.
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: E2E_BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromiumExecutablePathOverride(),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
