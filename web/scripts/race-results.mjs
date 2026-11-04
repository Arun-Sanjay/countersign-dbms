#!/usr/bin/env node
// Converts the Innovative Experiment's results (experiments/race/results/*.csv, results.md) and
// its SQL (experiments/race/schema.sql, analysis.sql, harness.py, and the fixture's Q35 block,
// read only) into web/src/data/race-results.json for the Race arena page (/race).
//
// Aggregates only: one row per strategy x isolation x N cell (72), one per N = 2 strategy x
// isolation (18), and the 18 example schedules. Never the 72,000 raw runs. The output is
// deterministic (no timestamps), so re-running it on unchanged inputs changes nothing.
//
// Every example schedule's precedence graph is recomputed with src/lib/precedence.ts and
// compared with the SQL's own answer (analysis.sql, in the CSV): a mismatch fails the script.
//
// Run: npm run race:results    (also runs before `npm run build`; with --if-present it keeps the
// committed JSON when the experiments/ folder is not there, e.g. a build of web/ alone).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSchedule, precedenceGraph } from '../src/lib/precedence.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const raceDir = path.join(root, 'experiments/race')
const resultsDir = path.join(raceDir, 'results')
const outFile = path.resolve(here, '../src/data/race-results.json')

if (!existsSync(path.join(resultsDir, 'cell_summary.csv'))) {
  if (process.argv.includes('--if-present') && existsSync(outFile)) {
    console.log(`race:results -> ${path.relative(process.cwd(), outFile)} kept (no experiments/race/results here)`)
    process.exit(0)
  }
  console.error('race:results: experiments/race/results/cell_summary.csv not found')
  process.exit(1)
}

// ---- CSV ----------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
const csv = (name) => parseCsv(readFileSync(path.join(resultsDir, name), 'utf8'))

const ISO = { 'READ COMMITTED': 'RC', 'REPEATABLE READ': 'RR', SERIALIZABLE: 'SER' }
const iso = (s) => {
  const v = ISO[s]
  if (!v) throw new Error(`unknown isolation "${s}"`)
  return v
}
const num = (s) => Number(s)
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d
const key = (r) => `${r.strategy}|${iso(r.isolation)}|${r.n_clients}`

// ---- the matrix ---------------------------------------------------------------------------------
const outcomes = new Map(csv('outcome_mix.csv').map((r) => [key(r), r]))
const excess = new Map(csv('over_admission_by_cell.csv').map((r) => [key(r), r]))
const cells = csv('cell_summary.csv').map((r) => {
  const o = outcomes.get(key(r))
  const x = excess.get(key(r))
  if (!o || !x) throw new Error(`cell ${key(r)} missing from outcome_mix / over_admission_by_cell`)
  const [worst, cap] = r.worst_size.split('/').map(Number)
  return {
    s: r.strategy,
    iso: iso(r.isolation),
    n: num(r.n_clients),
    trials: num(r.trials),
    over: num(r.over_admission_pct),
    worst,
    cap,
    meanExcess: round(num(x.mean_excess)),
    admitted: num(r.mean_admitted),
    aborts: num(r.mean_aborts_40001),
    refused: num(r.mean_refused),
    retries: num(r.mean_retries),
    p50: num(r.p50_ms),
    p95: num(r.p95_ms),
    rank: num(r.p95_rank),
    mix: {
      admitted: num(o.admitted),
      refused: num(o.refused),
      serialization_failure: num(o.serialization_failure),
      deadlock: num(o.deadlock),
      error: num(o.error),
    },
  }
})
if (cells.length !== 72) throw new Error(`expected 72 cells, got ${cells.length}`)

const serializability = csv('serializability_n2.csv').map((r) => ({
  s: r.strategy,
  iso: iso(r.isolation),
  runs: num(r.runs),
  serializable: num(r.conflict_serializable),
  notSerializable: num(r.not_conflict_serializable),
  overAdmitted: num(r.over_admitted),
  verdictMatches: num(r.verdict_matches_outcome),
  cycleOnlyWithAborted: num(r.cycle_only_with_aborted),
  brokenByDbms: num(r.cycle_broken_by_dbms_abort),
}))

// ---- example schedules, re-checked against the SQL ----------------------------------------------
const fmtEdges = (edges) =>
  edges.length
    ? edges
        .map((e) => `${e.from}->${e.to}`)
        .sort()
        .join(', ')
    : '(none)'
const examples = csv('schedule_examples_n2.csv').map((r) => {
  const ops = parseSchedule(r.logical_schedule)
  const g = precedenceGraph(ops)
  const committedEdges = g.edges.filter((e) => e.committed)
  const mine = {
    edges: fmtEdges(committedEdges),
    verdict: g.verdict,
    cycleOrSerial: (g.cycle ?? g.serialOrder ?? []).join(' -> '),
    cycleAll: (g.cycleInclAborted ?? []).join(' -> '),
  }
  const sql = { edges: r.edges, verdict: r.verdict, cycleOrSerial: r.cycle_or_serial_order, cycleAll: r.cycle_incl_aborted }
  for (const k of Object.keys(mine)) {
    if (mine[k] !== sql[k]) {
      throw new Error(`precedence.ts disagrees with analysis.sql on run ${r.run_id} (${r.strategy} ${r.isolation}) ${k}: "${mine[k]}" vs "${sql[k]}"`)
    }
  }
  const [size, cap] = r.size.split('/').map(Number)
  return {
    runId: num(r.run_id),
    s: r.strategy,
    iso: iso(r.isolation),
    finalSize: size,
    cap,
    // parsed in the browser with parseSchedule() (src/lib/precedence.ts), checked above
    schedule: r.logical_schedule,
    sql: { edges: r.edges, verdict: r.verdict, cycleOrSerialOrder: r.cycle_or_serial_order, cycleInclAborted: r.cycle_incl_aborted || null },
  }
})

// ---- meta from results.md -------------------------------------------------------------------------
const md = readFileSync(path.join(resultsDir, 'results.md'), 'utf8')
const pg = /PostgreSQL (\d+\.\d+)/.exec(md)?.[1] ?? null
const windowMatch = /Runs from ([\d-]+ [\d:]+) to ([\d:]+) UTC/.exec(md)
const scheduleOps = /([\d,]+) logged schedule operations/.exec(md)?.[1]?.replaceAll(',', '') ?? null
const meta = {
  races: cells.reduce((a, c) => a + c.trials, 0),
  attempts: cells.reduce((a, c) => a + Object.values(c.mix).reduce((x, y) => x + y, 0), 0),
  trialsPerCell: Math.min(...cells.map((c) => c.trials)),
  cells: cells.length,
  scheduleOps: scheduleOps ? Number(scheduleOps) : null,
  postgres: pg,
  window: windowMatch ? `${windowMatch[1]} to ${windowMatch[2]} UTC` : null,
  team: 'T02',
  capacity: cells[0].cap,
  freeSeats: 1,
  sources: [
    'experiments/race/results/cell_summary.csv',
    'experiments/race/results/outcome_mix.csv',
    'experiments/race/results/over_admission_by_cell.csv',
    'experiments/race/results/serializability_n2.csv',
    'experiments/race/results/schedule_examples_n2.csv',
    'experiments/race/results/results.md',
  ],
}

// ---- SQL, verbatim ---------------------------------------------------------------------------------
const read = (p) => readFileSync(path.join(root, p), 'utf8')

/** The comment lines directly above `index` (as extract-sql.mjs). */
function leadingComments(text, index) {
  const before = text.slice(0, index).split('\n')
  before.pop()
  const out = []
  while (before.length) {
    const line = before[before.length - 1]
    if (/^\s*--/.test(line) && !/^\s*-- -+\s*$/.test(line) && !/^\s*-- =+\s*$/.test(line)) {
      out.unshift(line)
      before.pop()
    } else break
  }
  return out.join('\n')
}

/** One statement starting at a line matching `start`, up to its `;` (outside $$ and comments). */
function statement(file, start) {
  const text = read(file)
  const m = new RegExp(start, 'm').exec(text)
  if (!m) throw new Error(`${file}: no statement matching /${start}/`)
  let i = m.index
  let dollar = false
  let quote = false
  for (; i < text.length; i++) {
    const ch = text[i]
    if (!quote && text.startsWith('$$', i)) {
      dollar = !dollar
      i++
    } else if (dollar) continue
    else if (quote) {
      if (ch === "'") quote = false
    } else if (ch === "'") quote = true
    else if (ch === '-' && text[i + 1] === '-') i = text.indexOf('\n', i) - 1
    else if (ch === ';') break
  }
  const lineEnd = text.indexOf('\n', i)
  return { file, comment: leadingComments(text, m.index), sql: text.slice(m.index, lineEnd === -1 ? undefined : lineEnd).trimEnd() }
}

const harness = read('experiments/race/harness.py')
const insMember = /^INS_MEMBER = "([^"]+)"/m.exec(harness)?.[1]
const maxRetries = /^S4_MAX_RETRIES = (\d+)/m.exec(harness)?.[1]
if (!insMember || !maxRetries) throw new Error('harness.py: INS_MEMBER / S4_MAX_RETRIES not found')

/** The SQL each harness strategy body sends, in order (Python string literals joined). */
function harnessSql(fn) {
  const startIdx = harness.indexOf(`async def ${fn}(`)
  if (startIdx < 0) throw new Error(`harness.py: no ${fn}`)
  const rest = harness.slice(startIdx + 1)
  const end = rest.search(/\n(?:async def |def |BODIES)/)
  const body = rest.slice(0, end)
  const out = []
  for (const m of body.matchAll(/conn\.(?:fetchrow|fetchval|execute)\(\s*((?:"[^"]*"\s*)+|INS_MEMBER)/g)) {
    out.push(m[1] === 'INS_MEMBER' ? insMember : [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('\n'))
  }
  return out.map((s) => `${s};`).join('\n')
}

const harnessSource = (fn, label, lines) => ({
  label,
  file: 'experiments/race/harness.py',
  comment: '',
  sql: `-- ${fn}() in experiments/race/harness.py ($1 = 'T02', $2 = the racer's USN)\n${harnessSql(fn)}\n${lines.map((l) => `-- ${l}`).join('\n')}`,
})

const q35 = (() => {
  const text = read('supabase/fixture/03_queries.sql')
  const a = text.search(/^-- Q35\./m)
  const b = text.search(/^-- Q36\./m)
  if (a < 0 || b < 0) throw new Error('03_queries.sql: Q35 block not found')
  const block = text.slice(a, b).trimEnd()
  return { label: 'check_team_capacity() + trg_team_capacity (fixture Q35)', file: 'supabase/fixture/03_queries.sql', comment: '', sql: block }
})()

const schema = 'experiments/race/schema.sql'
const analysis = 'experiments/race/analysis.sql'
const named = (label, s) => ({ label, ...s })
const sql = {
  S1: [harnessSource('body_naive', 'Client: check, think, insert', ['COUNT >= max_size -> ROLLBACK ("team is full"); else COMMIT. No lock, no constraint.'])],
  S2: [
    q35,
    harnessSource('body_trigger_q35', 'Client: a plain INSERT', ['the BEFORE INSERT trigger above locks the team row FOR UPDATE, then COUNTs']),
  ],
  S3: [
    named('exp.team_counter', statement(schema, '^CREATE TABLE exp\\.team_counter')),
    harnessSource('body_counter', 'Client: conditional UPDATE, then INSERT', ['no row back from the UPDATE -> ROLLBACK ("team is full")']),
  ],
  S4: [
    harnessSource('body_naive', 'Client: S1 inside a retry loop', [
      `on SQLSTATE 40001 / 40P01: ROLLBACK, sleep 1-5 ms x 2^(retry-1), BEGIN again and re-run (at most ${maxRetries} retries)`,
      'one_client() in harness.py: the retry loop',
    ]),
  ],
  S6: [
    named('exp.team_seat_slot', statement(schema, '^CREATE TABLE exp\\.team_seat_slot')),
    named('exp.team_seat', statement(schema, '^CREATE TABLE exp\\.team_seat \\(')),
    named('exp.claim_seat()', statement(schema, '^CREATE FUNCTION exp\\.claim_seat')),
    harnessSource('body_seats', 'Client: claim a seat, then INSERT', ['NULL seat -> count free seats; 0 -> ROLLBACK ("team is full")']),
  ],
  S7: [
    named('exp.enforce_team_capacity_v2()', statement(schema, '^CREATE FUNCTION exp\\.enforce_team_capacity_v2')),
    named('trg_team_capacity_v2', statement(schema, '^CREATE TRIGGER trg_team_capacity_v2')),
    harnessSource('body_trigger_v2', 'Client: a plain INSERT', ['the BEFORE INSERT trigger writes the team row (no-op UPDATE), then COUNTs']),
  ],
  common: [
    named('exp.use_strategy()', statement(schema, '^CREATE FUNCTION exp\\.use_strategy')),
    named('exp.reset_t02()', statement(schema, '^CREATE FUNCTION exp\\.reset_t02')),
  ],
  matrix: [named('exp.v_cell_summary', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_cell_summary'))],
  precedence: [
    named('exp.v_precedence_edge_scoped', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_precedence_edge_scoped')),
    named('exp.v_committed_txn', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_committed_txn')),
    named('exp.v_precedence_cycle', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_precedence_cycle')),
    named('exp.v_serial_order', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_serial_order')),
    named('exp.v_run_serializability', statement(analysis, '^CREATE OR REPLACE VIEW exp\\.v_run_serializability')),
  ],
}

const out = { meta, cells, serializability, examples, sql }
const json = JSON.stringify(out, null, 1) + '\n'
const before = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null
if (before !== json) writeFileSync(outFile, json)
console.log(
  `race:results -> ${path.relative(process.cwd(), outFile)} (${(json.length / 1024).toFixed(1)} KB, ` +
    `${cells.length} cells, ${examples.length} schedules re-checked against analysis.sql${before === json ? ', unchanged' : ''})`,
)
