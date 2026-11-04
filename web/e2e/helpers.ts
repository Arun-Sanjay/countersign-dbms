import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test as base, expect, type Locator, type Page } from '@playwright/test'

export const PASSWORD = 'Countersign@2026'

export const PERSONAS = {
  arun: { email: 'arun@example.edu', name: 'S Arun Sanjay', usn: '1RV24CY047', home: '/hub' },
  sanvid: { email: 'sanvid@example.edu', name: 'Sanvid Razdan', usn: '1RV24CY051', home: '/hub' },
  nikhil: { email: 'nikhil@example.edu', name: 'Nikhil Bhat', usn: '1RV24CY077', home: '/hub' },
  meera: { email: 'meera@example.edu', name: 'Meera Iyer', usn: '1RV24CY033', home: '/hub' },
  ramesh: { email: 'ramesh@example.edu', name: 'Dr. Ramesh Babu', usn: null, home: '/teaching' },
  lakshmi: { email: 'lakshmi@example.edu', name: 'Dr. Lakshmi Prasad', usn: null, home: '/teaching' },
  admin: { email: 'admin@example.edu', name: 'Administrator', usn: null, home: '/admin' },
} as const
export type PersonaKey = keyof typeof PERSONAS

/** The claim statement arun files in 02 and sanvid countersigns in 03. */
export const ARUN_C3_STATEMENT = 'Reviewed ER diagram v2 and added the cardinality and participation constraints for TEAM_MEMBER (e2e).'

// ---- fixtures: every test fails on an uncaught page exception -------------------------------------
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await use(errors)
      if (errors.length) {
        await testInfo.attach('page-errors', { body: errors.join('\n'), contentType: 'text/plain' })
      }
      expect(errors, 'uncaught exceptions in the page').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

// ---- UI helpers ----------------------------------------------------------------------------------
/** Sign in through the real form (not the persona shortcut) and wait for the landing route. */
export async function login(page: Page, who: PersonaKey): Promise<void> {
  const p = PERSONAS[who]
  await page.goto('/login')
  await page.getByLabel('Email').fill(p.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByTestId('sign-in').click()
  await page.waitForURL((u) => u.pathname === p.home, { timeout: 20_000 })
  await expect(page.getByTestId('current-user-name')).toHaveText(p.name)
}

/** Click a panel's "</> SQL" pill and return the opened sheet. */
export async function openSql(page: Page, panelId: string): Promise<Locator> {
  await page.locator(`[data-sql-panel="${panelId}"]`).first().click()
  const sheet = page.getByRole('dialog').filter({ hasText: 'Show the SQL' })
  await expect(sheet).toBeVisible()
  return sheet
}

export async function closeSheet(page: Page, sheet: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
}

/** A sonner toast with this text. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

// ---- REST helper (anon key + a persona's own token; RLS applies; nothing printed) --------------
const envText = readFileSync(path.resolve(import.meta.dirname, '..', '.env.local'), 'utf8')
const SUPABASE_URL = /^VITE_SUPABASE_URL=(.*)$/m.exec(envText)?.[1]?.trim() ?? ''
const ANON_KEY = /^VITE_SUPABASE_ANON_KEY=(.*)$/m.exec(envText)?.[1]?.trim() ?? ''
const tokens = new Map<PersonaKey, string>()

async function token(who: PersonaKey): Promise<string> {
  const cached = tokens.get(who)
  if (cached) return cached
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PERSONAS[who].email, password: PASSWORD }),
  })
  if (!r.ok) throw new Error(`login ${who} via REST failed: HTTP ${r.status}`)
  const t = ((await r.json()) as { access_token: string }).access_token
  tokens.set(who, t)
  return t
}

/** GET /rest/v1/<pathAndQuery> as a persona. */
export async function restGet<T = Record<string, unknown>>(who: PersonaKey, pathAndQuery: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${await token(who)}` },
  })
  if (!r.ok) throw new Error(`GET ${pathAndQuery} as ${who}: HTTP ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

/** POST /rest/v1/rpc/<fn> as a persona; returns status and parsed body (errors are not thrown). */
export async function rpc(who: PersonaKey, fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null }
}
