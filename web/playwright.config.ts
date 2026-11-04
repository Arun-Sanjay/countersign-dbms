import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Countersign end-to-end suite (web/e2e). LOCAL ONLY.
 *
 *   npm run e2e                 reset the local DB + personas, start Vite (+ the API), run every spec
 *   E2E_SKIP_RESET=1 npm run e2e  skip `supabase db reset` (quick re-runs; specs assume seed state)
 *   E2E_API=0 npm run e2e       never start the FastAPI notes service (the /notes spec then checks the offline state)
 *
 * The specs share one database and run in file order (01 … 09) with one worker: 02 files a claim
 * that 03 countersigns, 05 locks C2, and so on. globalSetup resets the database first, so the
 * suite is idempotent.
 *
 * The browser is the installed Google Chrome (channel "chrome"): no browser download needed.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173)
const BASE_URL = `http://127.0.0.1:${PORT}`
const API_PORT = 8000

/** Start the API only when asked for (default) and the local Mongo container is up. */
function apiAvailable(): boolean {
  if (process.env.E2E_API === '0') return false
  try {
    const names = execSync("docker ps --format '{{.Names}}'", { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    return names.split('\n').includes('elp-mongo-local')
  } catch {
    return false
  }
}

const withApi = apiAvailable()
// Read by the specs (the config is evaluated in every worker too).
process.env.E2E_API_STARTED = withApi ? '1' : '0'
process.env.E2E_BASE_URL = BASE_URL

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  outputDir: './test-results/e2e',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      // .env.local (the LOCAL stack) is what `vite` (mode development) reads.
      command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    ...(withApi
      ? [
          {
            command: `uv run uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
            cwd: '../api',
            url: `http://127.0.0.1:${API_PORT}/health`,
            reuseExistingServer: true,
            timeout: 120_000,
            stdout: 'ignore' as const,
            stderr: 'pipe' as const,
            env: {
              SUPABASE_TARGET: 'local',
              MONGO_TARGET: 'local',
              CORS_ORIGINS: `http://localhost:${PORT},http://127.0.0.1:${PORT}`,
            },
          },
        ]
      : []),
  ],
})
