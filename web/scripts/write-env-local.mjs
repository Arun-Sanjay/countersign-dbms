#!/usr/bin/env node
// Writes web/.env.local from the running local Supabase stack (`supabase status -o env`).
// The anon key is a local-only demo key, but it is still never printed.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const out = path.resolve(here, '../.env.local')

let raw
try {
  raw = execSync('npx -y supabase@latest status -o env', { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
} catch {
  console.error('Could not read `supabase status`. Is the local stack running? (npx supabase start)')
  process.exit(1)
}
const vars = Object.fromEntries(
  raw
    .split('\n')
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const url = vars.API_URL
const key = vars.ANON_KEY || vars.PUBLISHABLE_KEY
if (!url || !key) {
  console.error('supabase status did not report API_URL and ANON_KEY')
  process.exit(1)
}
writeFileSync(
  out,
  `# Local Supabase stack (written by npm run env:local from \`supabase status\`). Git-ignored.\n` +
    `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`,
)
console.log(`wrote ${path.relative(process.cwd(), out)} -> ${url} (anon key hidden)`)
