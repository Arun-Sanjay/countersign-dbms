/**
 * Precedence (conflict) graph of a LOGICAL, client-recorded schedule: the same rules as
 * experiments/race/analysis.sql (exp.v_precedence_edge_scoped, v_precedence_cycle,
 * v_serial_order), in TypeScript, so the Race arena can draw a graph for a live N = 2 race.
 *
 *   edge Ti -> Tj  iff some op of Ti precedes a CONFLICTING op of Tj:
 *                  different transactions, same item, at least one is a write.
 *   scope 'committed' = only committed transactions are nodes (the textbook test, the verdict);
 *   scope 'all'       = aborted / refused transactions too.
 *
 * web/scripts/race-results.mjs imports this file (Node strips the types) and checks it against
 * the SQL's own answer for every example in experiments/race/results/schedule_examples_n2.csv,
 * so the two implementations cannot drift apart unnoticed. Keep it free of imports and of
 * non-erasable TypeScript syntax.
 */

export type OpKind = 'r' | 'w' | 'c' | 'a'

export interface ScheduleOp {
  seq: number
  /** 'T1', 'T2', retries 'T2.1' … */
  txn: string
  op: OpKind
  /** r/w: the item (members:T02 …); a: 'refused' or the SQLSTATE; c: null */
  item: string | null
}

export interface PrecedenceEdge {
  from: string
  to: string
  /** the conflicting pairs, e.g. "w2(members:T02) < r1(members:T02)" */
  because: string[]
  /** both ends committed (part of the committed projection) */
  committed: boolean
}

export interface TxnNode {
  txn: string
  status: 'committed' | 'refused' | 'aborted' | 'open'
  /** for aborted: the SQLSTATE (40001 …) */
  reason: string | null
}

export interface PrecedenceGraph {
  nodes: TxnNode[]
  /** scope 'all' edges; `committed` marks the ones in the committed projection */
  edges: PrecedenceEdge[]
  /** cycle in the committed projection, e.g. ['T1', 'T2', 'T1'], or null */
  cycle: string[] | null
  /** cycle when aborted transactions are included, or null */
  cycleInclAborted: string[] | null
  /** equivalent serial order of the committed projection (null when cyclic) */
  serialOrder: string[] | null
  /** topological order of every transaction (null when the full graph is cyclic) */
  serialOrderAll: string[] | null
  verdict: 'conflict-serializable' | 'NOT conflict-serializable'
}

/** "r2(members:T02)" / "c1" / "a2[40001]" (the analysis.sql notation). */
export function formatOp(o: ScheduleOp): string {
  const n = o.txn.replace(/^T/, '')
  if (o.op === 'r' || o.op === 'w') return `${o.op}${n}(${o.item ?? ''})`
  return o.item ? `${o.op}${n}[${o.item}]` : `${o.op}${n}`
}

/** Parse the logical_schedule column of schedule_examples_n2.csv. */
export function parseSchedule(text: string): ScheduleOp[] {
  return text
    .trim()
    .split(/\s+/)
    .map((tok, i) => {
      const m = /^([rwca])(\d+(?:\.\d+)?)(?:\(([^)]*)\)|\[([^\]]*)\])?$/.exec(tok)
      if (!m) throw new Error(`cannot parse schedule op "${tok}"`)
      return { seq: (i + 1) * 100, txn: `T${m[2]}`, op: m[1] as OpKind, item: m[3] ?? m[4] ?? null }
    })
}

function byTxn(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Shortest cycle, ties broken by the path's lexicographic order (as DISTINCT ON … ORDER BY cardinality(path), path). */
function findCycle(nodes: string[], edges: { from: string; to: string }[]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  let best: string[] | null = null
  const better = (p: string[]) => {
    if (!best || p.length < best.length) return true
    if (p.length > best.length) return false
    for (let i = 0; i < p.length; i++) {
      const c = byTxn(p[i] as string, best[i] as string)
      if (c) return c < 0
    }
    return false
  }
  for (const start of nodes) {
    const walk = (path: string[]) => {
      const cur = path[path.length - 1] as string
      for (const next of adj.get(cur) ?? []) {
        if (next === start) {
          const closed = [...path, next]
          if (better(closed)) best = closed
        } else if (!path.includes(next)) walk([...path, next])
      }
    }
    walk([start])
  }
  return best
}

/** Topological levels (longest path from a source), ordered by depth then name. */
function serialOrder(nodes: string[], edges: { from: string; to: string }[]): string[] {
  const depth = new Map<string, number>()
  const visit = (n: string, d: number, guard: number) => {
    if (guard > 16) return
    if ((depth.get(n) ?? -1) < d) depth.set(n, d)
    for (const e of edges) if (e.from === n) visit(e.to, d + 1, guard + 1)
  }
  for (const n of nodes) if (!edges.some((e) => e.to === n)) visit(n, 0, 0)
  return [...nodes].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || byTxn(a, b))
}

export function precedenceGraph(ops: ScheduleOp[]): PrecedenceGraph {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq)
  const committed = new Set(sorted.filter((o) => o.op === 'c').map((o) => o.txn))
  const txns = [...new Set(sorted.map((o) => o.txn))].sort(byTxn)
  const nodes: TxnNode[] = txns.map((t) => {
    const end = sorted.find((o) => o.txn === t && (o.op === 'c' || o.op === 'a'))
    if (!end) return { txn: t, status: 'open', reason: null }
    if (end.op === 'c') return { txn: t, status: 'committed', reason: null }
    return end.item === 'refused' ? { txn: t, status: 'refused', reason: null } : { txn: t, status: 'aborted', reason: end.item }
  })

  const rw = sorted.filter((o) => o.op === 'r' || o.op === 'w')
  const map = new Map<string, PrecedenceEdge>()
  for (const a of rw) {
    for (const b of rw) {
      if (b.item !== a.item || b.txn === a.txn || b.seq <= a.seq || (a.op !== 'w' && b.op !== 'w')) continue
      const key = `${a.txn}>${b.txn}`
      const e = map.get(key) ?? { from: a.txn, to: b.txn, because: [], committed: committed.has(a.txn) && committed.has(b.txn) }
      const why = `${formatOp(a)} < ${formatOp(b)}`
      if (!e.because.includes(why)) e.because.push(why)
      map.set(key, e)
    }
  }
  const edges = [...map.values()].sort((x, y) => byTxn(x.from, y.from) || byTxn(x.to, y.to))
  for (const e of edges) e.because.sort()
  const cEdges = edges.filter((e) => e.committed)
  const cNodes = txns.filter((t) => committed.has(t))
  const cycle = findCycle(cNodes, cEdges)
  const cycleAll = findCycle(txns, edges)
  return {
    nodes,
    edges,
    cycle,
    cycleInclAborted: cycleAll,
    serialOrder: cycle ? null : serialOrder(cNodes, cEdges),
    serialOrderAll: cycleAll ? null : serialOrder(txns, edges),
    verdict: cycle ? 'NOT conflict-serializable' : 'conflict-serializable',
  }
}
