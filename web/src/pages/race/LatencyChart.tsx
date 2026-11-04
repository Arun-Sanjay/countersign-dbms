import { useState, type PointerEvent } from 'react'
import { cellOf, fmtMs, ISOS, NS, STRATEGIES, type IsoId, type StrategyId } from '@/pages/race/data'
import { Segmented } from '@/pages/race/Segmented'

const SERIES: Record<StrategyId, string> = {
  S1: 'var(--series-1)',
  S2: 'var(--series-2)',
  S3: 'var(--series-3)',
  S4: 'var(--series-4)',
  S6: 'var(--series-5)',
  S7: 'var(--series-6)',
}

const W = 640
const H = 260
const M = { top: 14, right: 18, bottom: 34, left: 46 }
const iw = W - M.left - M.right
const ih = H - M.top - M.bottom
const lx = (n: number) => M.left + ((Math.log2(n) - 1) / (Math.log2(100) - 1)) * iw

/** A 1-2-5 step that gives at most 5 gridlines, and the axis maximum rounded up to it. */
function niceAxis(v: number): { max: number; step: number } {
  const raw = v / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return { max: Math.ceil(v / step) * step, step }
}

/** p95 latency per strategy vs N, one isolation level at a time (one axis, six lines). */
export function LatencyChart() {
  const [iso, setIso] = useState<IsoId>('SER')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hoverN, setHoverN] = useState<number | null>(null)

  const rows = STRATEGIES.map((s) => ({ s, pts: NS.map((n) => ({ n, c: cellOf(s.id, iso, n) })) }))
  const { max: yMax, step } = niceAxis(Math.max(...rows.flatMap((r) => r.pts.map((p) => p.c?.p95 ?? 0))))
  const ly = (v: number) => M.top + ih - (v / yMax) * ih
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W
    let best: number = NS[0]
    for (const n of NS) if (Math.abs(lx(n) - x) < Math.abs(lx(best) - x)) best = n
    setHoverN(best)
  }
  const hovered = hoverN === null ? [] : rows.map((r) => ({ s: r.s, c: cellOf(r.s.id, iso, hoverN) })).sort((a, b) => (b.c?.p95 ?? 0) - (a.c?.p95 ?? 0))

  return (
    <div className="race-viz space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Isolation level" value={iso} onChange={setIso} options={ISOS.map((i) => ({ value: i.id, label: i.name }))} />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>

      {/* legend: always present for six series (line keys, mirroring the marks) */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {STRATEGIES.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden>
              <line x1="0" y1="4" x2="16" y2="4" stroke={SERIES[s.id]} strokeWidth="2" strokeLinecap="round" />
              <circle cx="8" cy="4" r="2.5" fill={SERIES[s.id]} />
            </svg>
            <span className="font-mono text-foreground">{s.id}</span> {s.name}
          </span>
        ))}
      </div>

      {view === 'chart' ? (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            aria-labelledby="race-latency-title"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverN(null)}
            data-testid="race-latency-chart"
          >
            <title id="race-latency-title">{`p95 latency in milliseconds by number of clients, ${ISOS.find((i) => i.id === iso)?.name}`}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={ly(t)} y2={ly(t)} className="stroke-border" strokeWidth={1} />
                <text x={M.left - 8} y={ly(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            <text x={12} y={M.top + ih / 2} transform={`rotate(-90 12 ${M.top + ih / 2})`} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              p95 latency (ms)
            </text>
            {NS.map((n) => (
              <text key={n} x={lx(n)} y={H - M.bottom + 18} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                N = {n}
              </text>
            ))}
            {hoverN !== null ? <line x1={lx(hoverN)} x2={lx(hoverN)} y1={M.top} y2={M.top + ih} className="stroke-foreground/30" strokeWidth={1} /> : null}
            {rows.map(({ s, pts }) => {
              const d = pts
                .filter((p) => p.c)
                .map((p, i) => `${i ? 'L' : 'M'}${lx(p.n).toFixed(1)},${ly(p.c!.p95).toFixed(1)}`)
                .join(' ')
              return (
                <g key={s.id}>
                  <path d={d} fill="none" stroke={SERIES[s.id]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p) =>
                    p.c ? (
                      <circle
                        key={p.n}
                        cx={lx(p.n)}
                        cy={ly(p.c.p95)}
                        r={hoverN === p.n ? 4.5 : 3.5}
                        fill={SERIES[s.id]}
                        className="stroke-card"
                        strokeWidth={2}
                      />
                    ) : null,
                  )}
                </g>
              )
            })}
          </svg>
          {hoverN !== null ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-48 rounded-lg bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
              style={lx(hoverN) > W / 2 ? { right: `${(1 - (lx(hoverN) - 12) / W) * 100}%` } : { left: `${((lx(hoverN) + 12) / W) * 100}%` }}
            >
              <div className="pb-1 font-medium text-muted-foreground">N = {hoverN} · p95 / p50</div>
              {hovered.map(({ s, c }) => (
                <div key={s.id} className="flex items-center gap-2 py-0.5">
                  <svg width="12" height="6" aria-hidden>
                    <line x1="0" y1="3" x2="12" y2="3" stroke={SERIES[s.id]} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="tabular w-14 text-right font-semibold">{c ? `${fmtMs(c.p95)} ms` : '–'}</span>
                  <span className="tabular w-12 text-right text-muted-foreground">{c ? fmtMs(c.p50) : ''}</span>
                  <span className="font-mono text-muted-foreground">{s.id}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="race-latency-table">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal">strategy</th>
                {NS.map((n) => (
                  <th key={n} className="py-1 text-right font-normal">
                    N = {n} p50 / p95 (ms)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, pts }) => (
                <tr key={s.id} className="border-t">
                  <td className="py-1.5">
                    <span className="font-mono font-medium">{s.id}</span> <span className="text-muted-foreground">{s.name}</span>
                  </td>
                  {pts.map((p) => (
                    <td key={p.n} className="tabular py-1.5 text-right">
                      {p.c ? `${fmtMs(p.c.p50)} / ${fmtMs(p.c.p95)}` : '–'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Per client, from its own release at the barrier to its final outcome. One machine, client and server sharing the CPU: relative costs,
        not production numbers. S1 and S4 include 10 ms of think time between the check and the insert.
      </p>
    </div>
  )
}
