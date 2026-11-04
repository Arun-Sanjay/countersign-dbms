import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Reset the LOCAL Supabase database to migrations + seed, then re-create the demo personas.
 * Refuses to run unless web/.env.local points at a local stack. Set E2E_SKIP_RESET=1 to skip.
 * No key is printed: the persona script reads the service key from `supabase status` itself.
 */
const WEB = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(WEB, '..')

function localEnv(): { url: string; anonKey: string } {
  const text = readFileSync(path.join(WEB, '.env.local'), 'utf8')
  const url = /^VITE_SUPABASE_URL=(.*)$/m.exec(text)?.[1]?.trim() ?? ''
  const anonKey = /^VITE_SUPABASE_ANON_KEY=(.*)$/m.exec(text)?.[1]?.trim() ?? ''
  return { url, anonKey }
}

function run(cmd: string, args: string[], what: string) {
  const started = Date.now()
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer }
    throw new Error(`${what} failed:\n${err.stderr?.toString() ?? ''}\n${err.stdout?.toString() ?? ''}`, { cause: e })
  }
  console.log(`[e2e setup] ${what}: ok (${((Date.now() - started) / 1000).toFixed(1)}s)`)
}

async function waitForAuth(url: string, anonKey: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'arun@example.edu', password: 'Countersign@2026' }),
      })
      if (r.ok) {
        const { access_token } = (await r.json()) as { access_token: string }
        const p = await fetch(`${url}/rest/v1/app_user?select=role`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${access_token}` },
        })
        if (p.ok && ((await p.json()) as unknown[]).length === 1) return
      }
    } catch {
      /* stack still restarting */
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  throw new Error('local stack did not accept persona logins after the reset')
}

export default async function globalSetup() {
  const { url, anonKey } = localEnv()
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey) {
    throw new Error(`e2e runs against the LOCAL stack only; web/.env.local has VITE_SUPABASE_URL=${url || '(empty)'}`)
  }
  if (process.env.E2E_SKIP_RESET === '1') {
    console.log('[e2e setup] E2E_SKIP_RESET=1: database NOT reset (specs assume the seed state)')
  } else {
    // `db reset` without --linked / --db-url only ever touches the local stack.
    run('npx', ['-y', 'supabase@latest', 'db', 'reset', '--local'], 'supabase db reset (local)')
    run(
      'uv',
      ['run', '--python', '3.12', '--with', 'httpx', '--with', 'python-dotenv', 'python', 'scripts/create_personas.py', '--target', 'local'],
      'create personas (local)',
    )
    // Postgres was reset, so the worker's raw log in the LOCAL Mongo container must go too,
    // or the admin consistency panel reports pushes that only Mongo remembers.
    run('scripts/clear_local_pipeline.sh', [], 'clear local Mongo pipeline documents')
  }
  await waitForAuth(url, anonKey)
}
