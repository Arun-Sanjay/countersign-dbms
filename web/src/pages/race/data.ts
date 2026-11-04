/**
 * The Race arena's data: aggregates of the Innovative Experiment (Component 10), converted at
 * build time from experiments/race/results by web/scripts/race-results.mjs. Plus the
 * strategy texts and the live-race API call.
 */
import { useMutation } from '@tanstack/react-query'
import raceResults from '@/data/race-results.json'
import { apiPost } from '@/lib/api'
import type { ScheduleOp } from '@/lib/precedence'
import type { SqlPanelId } from '@/sql/registry'

export type StrategyId = 'S1' | 'S2' | 'S3' | 'S4' | 'S6' | 'S7'
export type IsoId = 'RC' | 'RR' | 'SER'

export interface Cell {
  s: StrategyId
  iso: IsoId
  n: number
  trials: number
  /** % of races that ended above max_size */
  over: number
  worst: number
  cap: number
  meanExcess: number
  admitted: number
  aborts: number
  refused: number
  retries: number
  p50: number
  p95: number
  rank: number
  mix: Record<Outcome, number>
}

export type Outcome = 'admitted' | 'refused' | 'serialization_failure' | 'deadlock' | 'error'

/** How an attempt ended: state colours (status tokens), always shown with a text label. */
export const OUTCOME_META: Record<Outcome, { label: string; className: string }> = {
  admitted: { label: 'admitted', className: 'bg-brand' },
  refused: { label: 'refused (team full)', className: 'bg-muted-foreground/45' },
  serialization_failure: { label: '40001 serialization failure', className: 'bg-pending' },
  deadlock: { label: '40P01 deadlock', className: 'bg-contested' },
  error: { label: 'other error', className: 'bg-foreground' },
}

export const RESULTS = raceResults as unknown as {
  meta: {
    races: number
    attempts: number
    trialsPerCell: number
    cells: number
    scheduleOps: number | null
    postgres: string | null
    window: string | null
    team: string
    capacity: number
    freeSeats: number
    sources: string[]
  }
  cells: Cell[]
  serializability: {
    s: StrategyId
    iso: IsoId
    runs: number
    serializable: number
    notSerializable: number
    overAdmitted: number
    verdictMatches: number
    cycleOnlyWithAborted: number
    brokenByDbms: number
  }[]
  examples: {
    runId: number
    s: StrategyId
    iso: IsoId
    finalSize: number
    cap: number
    schedule: string
    sql: { edges: string; verdict: string; cycleOrSerialOrder: string; cycleInclAborted: string | null }
  }[]
}

export const NS = [2, 8, 32, 100] as const
export const ISOS: { id: IsoId; name: string }[] = [
  { id: 'RC', name: 'READ COMMITTED' },
  { id: 'RR', name: 'REPEATABLE READ' },
  { id: 'SER', name: 'SERIALIZABLE' },
]
export const ISO_NAME: Record<IsoId, string> = { RC: 'READ COMMITTED', RR: 'REPEATABLE READ', SER: 'SERIALIZABLE' }

export interface Strategy {
  id: StrategyId
  name: string
  /** where the rule lives */
  where: string
  kind: 'procedural' | 'declarative'
  /** one line: why it does what it does */
  line: string
  sqlId: SqlPanelId
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'S1',
    name: 'Naive check-then-insert',
    where: 'application, no lock',
    kind: 'procedural',
    line: 'Every client counts 3 members and inserts a new row: write skew through a phantom, which only SSI notices.',
    sqlId: 'race.S1',
  },
  {
    id: 'S2',
    name: 'Fixture trigger (Q35)',
    where: 'trigger: lock the team row, then COUNT',
    kind: 'procedural',
    line: 'The lock queues the joiners, but under REPEATABLE READ the waiter still counts with its old snapshot, and a lock-only conflict raises no 40001.',
    sqlId: 'race.S2',
  },
  {
    id: 'S3',
    name: 'Conditional counter',
    where: 'one UPDATE … WHERE count < max',
    kind: 'procedural',
    line: 'Check and write are one statement on one row: RC waiters re-check the newest version, RR/SER waiters get 40001.',
    sqlId: 'race.S3',
  },
  {
    id: 'S4',
    name: 'Naive + retry on 40001',
    where: 'application retry loop',
    kind: 'procedural',
    line: 'SERIALIZABLE + retry is the textbook contract; below SERIALIZABLE nothing aborts, so the retry loop never runs.',
    sqlId: 'race.S4',
  },
  {
    id: 'S6',
    name: 'Declarative seat keys',
    where: 'PRIMARY KEY + UNIQUE + deferred FK',
    kind: 'declarative',
    line: 'Capacity becomes data and the rule becomes a key: two joins collide on one primary key, and an index ignores snapshots.',
    sqlId: 'race.S6',
  },
  {
    id: 'S7',
    name: 'Write the parent row (v2)',
    where: 'trigger: no-op UPDATE team, then COUNT',
    kind: 'procedural',
    line: 'The no-op UPDATE makes the conflict write–write: RC waiters re-read, RR/SER waiters lose with 40001 (first updater wins).',
    sqlId: 'race.S7',
  },
]
export const STRATEGY: Record<StrategyId, Strategy> = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<StrategyId, Strategy>

const byKey = new Map(RESULTS.cells.map((c) => [`${c.s}|${c.iso}|${c.n}`, c]))
export function cellOf(s: StrategyId, iso: IsoId, n: number): Cell | undefined {
  return byKey.get(`${s}|${iso}|${n}`)
}

/** Over-admission % pooled over N (equal trials per cell). */
export function pooledOver(s: StrategyId, iso: IsoId): number {
  const cs = NS.map((n) => cellOf(s, iso, n)).filter((c): c is Cell => Boolean(c))
  return cs.length ? cs.reduce((a, c) => a + c.over, 0) / cs.length : 0
}

export const fmtInt = (n: number) => n.toLocaleString('en-US') // the reports' grouping: 2,556,000
export const fmtMs = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))

// ---- live race (POST /race/run) ------------------------------------------------------------
export interface LiveClient {
  client_no: number
  outcome: Outcome
  sqlstate: string | null
  latency_ms: number
  retries: number
}

export interface LiveRace {
  strategy: StrategyId
  isolation: IsoId
  isolation_name: string
  n: number
  admitted: number
  refused: number
  aborted: number
  errors: number
  aborts_40001: number
  retries: number
  final_size: number
  max_size: number
  over_admitted: boolean
  duration_ms: number
  clients: LiveClient[]
  schedule: ScheduleOp[] | null
  lab: string
}

export interface LiveRaceInput {
  strategy: StrategyId
  isolation: IsoId
  n: number
}

export function useLiveRace() {
  // a 100-client race at SERIALIZABLE with retries takes well under a second; allow for a cold lab
  // never retried automatically: a retry would run a second race
  return useMutation<LiveRace, Error, LiveRaceInput>({
    mutationFn: (body) => apiPost<LiveRace>('/race/run', body, 70_000),
    retry: false,
  })
}

export const RACE_LAB_START = 'experiments/race/setup.sh'
