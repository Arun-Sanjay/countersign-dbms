import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatOp, precedenceGraph, type PrecedenceEdge, type ScheduleOp, type TxnNode } from '@/lib/precedence'

const W = 300
const H = 170
const R = 22

function layout(nodes: TxnNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const k = nodes.length
  if (k === 1) pos.set(nodes[0]!.txn, { x: W / 2, y: H / 2 })
  else if (k === 2) {
    pos.set(nodes[0]!.txn, { x: 70, y: H / 2 })
    pos.set(nodes[1]!.txn, { x: W - 70, y: H / 2 })
  } else {
    nodes.forEach((n, i) => {
      const a = Math.PI + (2 * Math.PI * i) / k
      pos.set(n.txn, { x: W / 2 + 95 * Math.cos(a), y: H / 2 + 58 * Math.sin(a) })
    })
  }
  return pos
}

/** A quadratic arc from a to b, bent to its left when the reverse edge exists, trimmed to the node circles. */
function arc(a: { x: number; y: number }, b: { x: number; y: number }, bend: number) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const cx = mx + (-dy / len) * bend
  const cy = my + (dx / len) * bend
  const trim = (p: { x: number; y: number }, gap: number) => {
    const vx = p.x - cx
    const vy = p.y - cy
    const l = Math.hypot(vx, vy) || 1
    return { x: p.x - (vx / l) * gap, y: p.y - (vy / l) * gap }
  }
  const s = trim(a, R + 2)
  const e = trim(b, R + 7)
  return { d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`, lx: (mx + cx) / 2, ly: (my + cy) / 2 }
}

const onCycle = (cycle: string[] | null, e: PrecedenceEdge) =>
  Boolean(cycle && cycle.some((t, i) => t === e.from && cycle[i + 1] === e.to))

/** The precedence graph of a logical schedule: nodes = transactions, edges = conflicts. */
export function PrecedenceGraphSvg({ ops, focus, idPrefix }: { ops: ScheduleOp[]; focus?: string | null; idPrefix: string }) {
  const g = useMemo(() => precedenceGraph(ops), [ops])
  const pos = layout(g.nodes)
  const cyc = g.cycle ?? g.cycleInclAborted
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[340px]">
      <title>{`precedence graph: ${g.edges.map((e) => `${e.from} to ${e.to}`).join(', ') || 'no edges'}`}</title>
      <defs>
        {(['muted', 'cycle'] as const).map((k) => (
          <marker key={k} id={`${idPrefix}-arrow-${k}`} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={k === 'cycle' ? 'fill-contested' : 'fill-muted-foreground'} />
          </marker>
        ))}
      </defs>
      {g.edges.map((e) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        const twoWay = g.edges.some((x) => x.from === e.to && x.to === e.from)
        const { d } = arc(a, b, twoWay ? 34 : 0)
        const hot = onCycle(cyc, e)
        const lit = focus === `${e.from}>${e.to}`
        return (
          <path
            key={`${e.from}>${e.to}`}
            d={d}
            fill="none"
            strokeWidth={lit ? 3 : 2}
            strokeDasharray={e.committed ? undefined : '5 4'}
            markerEnd={`url(#${idPrefix}-arrow-${hot ? 'cycle' : 'muted'})`}
            className={hot ? 'stroke-contested' : 'stroke-muted-foreground'}
          />
        )
      })}
      {g.nodes.map((n) => {
        const p = pos.get(n.txn)!
        const solid = n.status === 'committed'
        return (
          <g key={n.txn}>
            <circle
              cx={p.x}
              cy={p.y}
              r={R}
              strokeWidth={2}
              strokeDasharray={solid ? undefined : '4 3'}
              className={cn(solid ? 'fill-brand-soft stroke-brand' : n.status === 'aborted' ? 'fill-card stroke-pending' : 'fill-card stroke-muted-foreground')}
            />
            <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" className={cn('font-mono text-[13px] font-semibold', solid ? 'fill-brand' : 'fill-muted-foreground')}>
              {n.txn}
            </text>
            <text x={p.x} y={p.y + R + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {n.status === 'aborted' ? `aborted ${n.reason ?? ''}` : n.status}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Graph + the ops as a timeline + the edges with the conflicting pairs behind them. */
export function ScheduleExplainer({ ops, idPrefix, testId }: { ops: ScheduleOp[]; idPrefix: string; testId?: string }) {
  const g = useMemo(() => precedenceGraph(ops), [ops])
  const [focus, setFocus] = useState<string | null>(null)
  const focusOps = new Set(
    focus ? (g.edges.find((e) => `${e.from}>${e.to}` === focus)?.because ?? []).flatMap((b) => b.split(' < ')) : [],
  )
  const txnIndex = new Map(g.nodes.map((n, i) => [n.txn.split('.')[0], i]))
  const sorted = [...ops].sort((a, b) => a.seq - b.seq)

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex justify-center rounded-lg bg-muted/30 py-2 ring-1 ring-foreground/5">
        <PrecedenceGraphSvg ops={ops} focus={focus} idPrefix={idPrefix} />
      </div>
      <div>
        <div className="pb-1.5 text-xs font-medium text-muted-foreground">Logical schedule (in order)</div>
        <ol className="flex flex-wrap gap-1" data-testid={testId ? `${testId}-ops` : undefined}>
          {sorted.map((o) => {
            const label = formatOp(o)
            const second = (txnIndex.get(o.txn.split('.')[0]) ?? 0) % 2 === 1
            return (
              <li
                key={o.seq}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[11.5px] ring-1 transition-shadow',
                  second ? 'bg-info-soft text-info ring-info/20' : 'bg-brand-soft text-brand ring-brand/20',
                  (o.op === 'c' || o.op === 'a') && 'font-semibold',
                  focusOps.has(label) && 'ring-2 ring-contested',
                )}
              >
                {label}
              </li>
            )
          })}
        </ol>
      </div>
      <div>
        <div className="pb-1.5 text-xs font-medium text-muted-foreground">Edges (hover to see the conflicting operations)</div>
        {g.edges.length ? (
          <ul className="space-y-1 text-xs">
            {g.edges.map((e) => {
              const k = `${e.from}>${e.to}`
              return (
                <li key={k}>
                  <button
                    type="button"
                    onMouseEnter={() => setFocus(k)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(k)}
                    onBlur={() => setFocus(null)}
                    className="flex w-full gap-2 rounded px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className={cn('shrink-0 font-mono font-medium', onCycle(g.cycle ?? g.cycleInclAborted, e) && 'text-contested')}>
                      {e.from} → {e.to}
                    </span>
                    <span className="font-mono text-muted-foreground">{e.because.join('; ')}</span>
                    {!e.committed ? <span className="shrink-0 text-muted-foreground italic">(via an aborted / refused txn)</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No conflicting pair: no edges.</p>
        )}
      </div>
      <Verdict ops={ops} />
    </div>
  )
}

export function Verdict({ ops }: { ops: ScheduleOp[] }) {
  const g = useMemo(() => precedenceGraph(ops), [ops])
  const committed = g.nodes.filter((n) => n.status === 'committed').map((n) => n.txn)
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-sm ring-1',
        g.cycle ? 'bg-contested-soft text-contested ring-contested/20' : 'bg-confirmed-soft text-confirmed ring-confirmed/20',
      )}
      data-testid="precedence-verdict"
    >
      <span className="font-semibold">{g.verdict}.</span>{' '}
      {g.cycle ? (
        <>Cycle {g.cycle.join(' → ')} among committed transactions: no serial order explains both commits.</>
      ) : (
        <>
          Committed projection {`{${committed.join(', ')}}`}
          {g.serialOrder && g.serialOrder.length > 1 ? `, serial order ${g.serialOrder.join(' → ')}` : ''}.
          {g.cycleInclAborted ? (
            g.nodes.some((n) => n.status === 'aborted' && g.cycleInclAborted?.includes(n.txn)) ? (
              <> With the aborted transactions included there is a cycle {g.cycleInclAborted.join(' → ')}: the DBMS broke it by aborting a participant (40001).</>
            ) : (
              <>
                {' '}
                With the refused transaction included there is a cycle {g.cycleInclAborted.join(' → ')}: it read before and after the winner committed
                (allowed at READ COMMITTED), wrote nothing and rolled itself back, so nothing had to be broken.
              </>
            )
          ) : g.serialOrderAll && g.serialOrderAll.length > committed.length ? (
            <> Including the refused / aborted ones, the graph is still acyclic: {g.serialOrderAll.join(' → ')}.</>
          ) : null}
        </>
      )}
    </div>
  )
}
