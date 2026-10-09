import { existsSync } from 'node:fs'
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
function chromiumExecutablePathOverride(): string | undefined {
  const candidate =
    'C:\\Users\\ADMIN\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe'
  return existsSync(candidate) ? candidate : undefined
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
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
