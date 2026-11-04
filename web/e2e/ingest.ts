/**
 * Ingestion helpers for the e2e suite (LOCAL stack only). Nothing here prints a key.
 *
 *   deliver(push)  the INBOX step: scripts/replay_webhooks.py signs the push with the webhook
 *                  secret and POSTs it to the local github-webhook Edge Function (started by
 *                  ensureFunctionsServed() when it is not running).
 *   drain(push)    the WORKER step: `uv run python -m app.worker --once` (api/, local Mongo),
 *                  then checks BOTH halves: ingest_event is projected with a mongo_id, and the
 *                  local Mongo elp.github_events has the document _id = delivery id.
 *
 * The live path is what this spec guards, so a broken Edge Function or worker FAILS it. Only
 * with E2E_ALLOW_FALLBACK=1 may it fall back to calling ingest_receive() / project_push()
 * directly with the local service key (then the Mongo half is not checked, and the run is
 * annotated). E2E_INGEST_WORKER=0 (skip the worker, it drains the WHOLE queue) also needs
 * E2E_ALLOW_FALLBACK=1.
 *
 * Each push is built fresh (random SHAs, a unique word in the note text, a unique path), so
 * the spec also works on a database that was not reset (E2E_SKIP_RESET=1).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const WEB = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(WEB, '..')
const FIXTURES = path.join(ROOT, 'ingest', 'fixtures')
const OUT = path.join(WEB, 'test-results', 'e2e-ingest')

const envText = readFileSync(path.join(WEB, '.env.local'), 'utf8')
const SUPABASE_URL = /^VITE_SUPABASE_URL=(.*)$/m.exec(envText)?.[1]?.trim() ?? ''
const FN_URL = `${SUPABASE_URL}/functions/v1/github-webhook`

export const ALLOW_FALLBACK = process.env.E2E_ALLOW_FALLBACK === '1'
const LOCAL_MONGO = process.env.MONGODB_URI_LOCAL ?? 'mongodb://127.0.0.1:57018/?directConnection=true'

// ---- the push payload -------------------------------------------------------------------------
export interface Push {
  name: string
  delivery: string
  payload: Record<string, unknown>
  /** fixture file written for replay_webhooks.py (the exact bytes it signs) */
  file: string
}

const hex = (n: number) => randomBytes(n).toString('hex')

/** A made-up lowercase word that no seed text contains (letters only: one tsvector lexeme). */
export function uniqueWord(prefix: string): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return prefix + Array.from(randomBytes(8), (b) => letters[b % 26]).join('')
}

/**
 * One push of one commit that adds a markdown file, built on a real fixture (its repository,
 * pusher and sender blocks), so the Edge Function and project_push see GitHub's shape.
 */
export function buildPush(opts: {
  template: 't01_push_02.json' | 't00_push_01.json'
  author: { name: string; email: string; username: string }
  path: string
  message: string
  content: string
}): Push {
  const base = JSON.parse(readFileSync(path.join(FIXTURES, opts.template), 'utf8')) as Record<string, unknown>
  const sha = hex(20)
  const before = (base.after as string | undefined) ?? hex(20)
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const repo = base.repository as { html_url?: string }
  const commit = {
    id: sha,
    tree_id: hex(20),
    distinct: true,
    message: opts.message,
    timestamp: now,
    url: `${repo.html_url ?? 'https://github.com/x/y'}/commit/${sha}`,
    author: opts.author,
    committer: opts.author,
    added: [opts.path],
    removed: [],
    modified: [],
    x_contents: { [opts.path]: opts.content },
  }
  const { x_contents: _omit, ...head } = commit
  const payload = {
    ...base,
    before,
    after: sha,
    created: false,
    deleted: false,
    forced: false,
    compare: `${repo.html_url ?? ''}/compare/${before.slice(0, 12)}...${sha.slice(0, 12)}`,
    commits: [commit],
    head_commit: head,
  }
  mkdirSync(OUT, { recursive: true })
  const name = `e2e-${opts.template.slice(0, 3)}-${sha.slice(0, 7)}`
  const file = path.join(OUT, `${name}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 1))
  return { name, delivery: `e2e-${randomUUID()}`, payload, file }
}

// ---- local service key (never printed) --------------------------------------------------------
let serviceKeyCache: string | null = null
function serviceKey(): string {
  if (serviceKeyCache) return serviceKeyCache
  const out = execFileSync('npx', ['-y', 'supabase@latest', 'status', '-o', 'env'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 120_000,
  }).toString()
  const key = /^(?:SERVICE_ROLE_KEY|SECRET_KEY)="?([^"\n]+)"?$/m.exec(out)?.[1]
  if (!key) throw new Error('could not read the local service key from `supabase status`')
  serviceKeyCache = key
  return key
}

async function serviceRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const key = serviceKey()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${fn} (service role): HTTP ${r.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : null) as T
}

// ---- the Edge Function ------------------------------------------------------------------------
/** The function is served when an unsigned POST is refused with 401 (not 404/503 from the gateway). */
export async function webhookServed(): Promise<boolean> {
  try {
    const r = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-GitHub-Event': 'push', 'X-GitHub-Delivery': 'e2e-probe' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    return r.status === 401
  } catch {
    return false
  }
}

/**
 * Make sure the github-webhook function answers. If it does not, start
 * `supabase functions serve` for the duration of the spec. Returns a stop function, and
 * whether the function is reachable.
 */
export async function ensureFunctionsServed(timeoutMs = 120_000): Promise<{ served: boolean; stop: () => void }> {
  if (await webhookServed()) return { served: true, stop: () => {} }
  if (!existsSync(path.join(ROOT, 'supabase', 'functions', '.env'))) return { served: false, stop: () => {} }
  let child: ChildProcess | null = spawn('npx', ['-y', 'supabase@latest', 'functions', 'serve'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  const stop = () => {
    if (!child?.pid) return
    try {
      process.kill(-child.pid, 'SIGINT')
    } catch {
      /* already gone */
    }
    child = null
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await webhookServed()) return { served: true, stop }
    await new Promise((r) => setTimeout(r, 1500))
  }
  stop()
  return { served: false, stop: () => {} }
}

// ---- inbox ------------------------------------------------------------------------------------
/** Deliver the push. Returns which path was used. */
export async function deliver(push: Push, functionServed: boolean): Promise<'replay_webhooks.py' | 'ingest_receive (service role)'> {
  if (functionServed) {
    const manifest = path.join(OUT, `${push.name}.manifest.json`)
    writeFileSync(
      manifest,
      JSON.stringify({
        description: 'generated by web/e2e/ingest.ts',
        deliveries: [
          {
            name: push.name,
            file: path.basename(push.file),
            event: 'push',
            delivery: push.delivery,
            sign: 'valid',
            expect: { http: 202, status: 'queued', duplicate: false },
          },
        ],
      }),
    )
    try {
      execFileSync('uv', ['run', '--python', '3.12', 'python', 'scripts/replay_webhooks.py', '--manifest', manifest, '--url', FN_URL], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      })
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer }
      throw new Error(`replay_webhooks.py failed:\n${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`, { cause: e })
    }
    return 'replay_webhooks.py'
  }
  if (!ALLOW_FALLBACK) {
    throw new Error(
      'the github-webhook Edge Function is not served (npx supabase functions serve). Set E2E_ALLOW_FALLBACK=1 to call ingest_receive() directly instead.',
    )
  }
  const res = await serviceRpc<{ status: string }>('ingest_receive', {
    p_delivery_id: push.delivery,
    p_event_type: 'push',
    p_payload: push.payload,
  })
  if (res.status !== 'queued') throw new Error(`ingest_receive answered ${JSON.stringify(res)}`)
  return 'ingest_receive (service role)'
}

// ---- worker -----------------------------------------------------------------------------------
async function eventRow(delivery: string): Promise<{ status: string; mongo_id: string | null; error: string | null } | null> {
  const key = serviceKey()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ingest_event?select=status,mongo_id,error&delivery_id=eq.${encodeURIComponent(delivery)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const rows = (await r.json()) as { status: string; mongo_id: string | null; error: string | null }[]
  return rows[0] ?? null
}

/** How many elp.github_events documents have _id = delivery in the LOCAL Mongo container. */
function mongoRawEvents(delivery: string): number {
  const out = execFileSync(
    'uv',
    [
      'run',
      'python',
      '-c',
      'import sys; from pymongo import MongoClient; c = MongoClient(sys.argv[1], serverSelectionTimeoutMS=8000); print(c["elp"].github_events.count_documents({"_id": sys.argv[2]}))',
      LOCAL_MONGO,
      delivery,
    ],
    { cwd: path.join(ROOT, 'api'), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
  )
  return Number(out.toString().trim())
}

/**
 * Run the worker once and require that this push went through the WHOLE pipeline: projected
 * in Postgres with a mongo_id, and its raw event in the local Mongo. Returns which path did it.
 */
export async function drain(push: Push): Promise<string> {
  const api = path.join(ROOT, 'api')
  let workerNote = 'worker not present'
  let workerOk = false
  if (process.env.E2E_INGEST_WORKER === '0') workerNote = 'worker skipped (E2E_INGEST_WORKER=0)'
  else if (existsSync(path.join(api, 'app', 'worker.py'))) {
    try {
      execFileSync('uv', ['run', 'python', '-m', 'app.worker', '--once'], {
        cwd: api,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000,
        env: { ...process.env, SUPABASE_TARGET: 'local', MONGO_TARGET: 'local', MONGO_DB: 'elp' },
      })
      workerNote = 'worker --once'
      workerOk = true
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer }
      workerNote = `worker --once exited ${err.status ?? '?'}: ${(err.stderr?.toString() || err.stdout?.toString() || '').slice(-400)}`
    }
  }
  const ev = await eventRow(push.delivery)
  if (workerOk && ev?.status === 'projected') {
    if (!ev.mongo_id) throw new Error(`${push.delivery} is projected but has no mongo_id: the raw log step was skipped`)
    const docs = mongoRawEvents(push.delivery)
    if (docs !== 1) throw new Error(`${push.delivery}: expected 1 raw event in local Mongo elp.github_events, found ${docs}`)
    return `${workerNote}; Postgres projected + Mongo raw event ${push.delivery}`
  }
  if (!ALLOW_FALLBACK) {
    throw new Error(
      `the worker did not project ${push.delivery} (${workerNote}; ingest_event ${JSON.stringify(ev)}). Set E2E_ALLOW_FALLBACK=1 to project it with project_push() directly.`,
    )
  }
  // Fallback (opt-in): the projection step alone (no Mongo raw log), for this one delivery.
  if (ev?.status === 'projected') return `${workerNote}; FALLBACK: projected without the worker`
  const res = await serviceRpc<{ status: string }>('project_push', { p_delivery_id: push.delivery, p_payload: push.payload })
  if (res.status !== 'projected') throw new Error(`project_push answered ${JSON.stringify(res)}`)
  return `${workerNote}; FALLBACK: projected with project_push (service role), no Mongo raw log`
}
