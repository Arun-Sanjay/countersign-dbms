#!/usr/bin/env node
// Smoke test: drives the running dev server in Google Chrome (playwright-core, channel
// "chrome", so no browser download). Usage:  npm run dev  &  npm run smoke
//   BASE_URL=http://localhost:5173  SMOKE_OUT=./test-results  HEADED=1
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = path.resolve(process.env.SMOKE_OUT ?? 'test-results')
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, info = '') {
  results.push({ name, ok, info })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))

async function signOut() {
  await page.getByTestId('user-menu').click()
  await page.getByTestId('sign-out').click()
  await page.waitForURL('**/login', { timeout: 10_000 })
}

try {
  // 1. login page
  await page.goto(`${BASE}/login`)
  await page.getByText('Sign in to Countersign').waitFor()
  check('login page renders', await page.getByText('Unified Experiential Learning Platform — RVCE CD252IA').isVisible())
  check('persona panel lists 7 personas', (await page.locator('[data-testid^="persona-"]').count()) === 7)
  await page.screenshot({ path: path.join(OUT, '01-login.png') })

  // 2. wrong password -> friendly field error
  await page.getByLabel('Email').fill('arun@example.edu')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByTestId('sign-in').click()
  const err = page.getByText('Check your email and password and try again.')
  await err.waitFor({ timeout: 10_000 })
  check('wrong password maps to a field error', await err.isVisible())

  // 3. one-click persona: Arun (student) -> /hub
  await page.getByTestId('persona-arun').click()
  await page.waitForURL('**/hub', { timeout: 15_000 })
  const who = await page.getByTestId('current-user-name').textContent()
  check('arun lands on /hub', page.url().endsWith('/hub'), who ?? '')
  check('profile read from app_user + student', who === 'S Arun Sanjay')
  await page.getByRole('link', { name: 'Team & skills' }).waitFor()
  const projectLink = page.locator('a[href^="/projects/"]').first()
  await projectLink.waitFor({ timeout: 10_000 })
  check('student sidebar has a project link', true, (await projectLink.getAttribute('href')) ?? '')
  await page.screenshot({ path: path.join(OUT, '02-hub-arun.png') })

  // 4. Show the SQL
  await page.locator('[data-sql-panel="hub.overview"]').click()
  const sheet = page.getByRole('dialog')
  await sheet.getByText('Show the SQL').waitFor()
  check('SQL sheet shows verbatim migration SQL', (await sheet.textContent())?.includes('CREATE FUNCTION public.semester_hub') ?? false)
  await page.screenshot({ path: path.join(OUT, '03-sql-sheet.png') })
  await sheet.getByRole('tab', { name: /RLS/ }).click()
  check('SQL sheet lists RLS policies', await sheet.getByText('app_user_select').isVisible())
  await page.keyboard.press('Escape')

  // 5. a faculty-only route as a student -> explained, not blank
  await page.goto(`${BASE}/contested`)
  await page.getByText('This page is for faculty / admin accounts').waitFor()
  check('role guard explains faculty-only page', true)

  // 6. dark mode
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.goto(`${BASE}/projects/P06`)
  await page.getByText('Components, claims and receipts').waitFor()
  await page.screenshot({ path: path.join(OUT, '04-project-dark.png') })
  await signOut()
  check('sign out returns to /login', page.url().endsWith('/login'))

  // 7. faculty via the form -> /teaching (the projects he teaches) -> /sheet/P06
  await page.getByLabel('Email').fill('ramesh@example.edu')
  await page.getByLabel('Password').fill('Countersign@2026')
  await page.getByTestId('sign-in').click()
  await page.waitForURL('**/teaching', { timeout: 15_000 })
  await page.getByTestId('project-P06').waitFor()
  check('ramesh lands on his project list', page.url().endsWith('/teaching'), page.url())
  await page.getByTestId('project-P06').getByRole('link', { name: /Rubric sheet/ }).click()
  await page.waitForURL('**/sheet/P06', { timeout: 15_000 })
  check('project card opens the P06 rubric sheet', page.url().endsWith('/sheet/P06'), page.url())
  await page.screenshot({ path: path.join(OUT, '05-sheet-ramesh.png') })
  await signOut()

  // 8. admin
  await page.getByTestId('persona-admin').click()
  await page.waitForURL('**/admin', { timeout: 15_000 })
  check('admin lands on /admin', page.url().endsWith('/admin'))
  await signOut()

  // 9. public about page
  await page.goto(`${BASE}/about`)
  await page.getByText('Units I–V, and the features that demonstrate them').waitFor()
  check('about page is public', true)
  await page.screenshot({ path: path.join(OUT, '06-about.png'), fullPage: true })
} catch (e) {
  check('smoke run completed', false, String(e).split('\n')[0])
  await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {})
} finally {
  const relevant = consoleErrors.filter((t) => !/Failed to load resource.*400|status of 400/.test(t))
  check('no unexpected console errors', relevant.length === 0, relevant.slice(0, 3).join(' | '))
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`)
process.exit(failed.length ? 1 : 0)
