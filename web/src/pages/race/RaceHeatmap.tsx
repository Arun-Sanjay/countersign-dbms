import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cellOf, fmtInt, fmtMs, ISOS, NS, OUTCOME_META, STRATEGIES, STRATEGY, type Cell, type Outcome } from '@/pages/race/data'
import { Segmented } from '@/pages/race/Segmented'

type Metric = 'rate' | 'worst'

/** One hue (the "contested" ink), light → dark: 0 is the card surface, so "held" recedes. */
function fill(c: Cell, metric: Metric): string {
  const t = metric === 'rate' ? c.over / 100 : c.worst > c.cap ? Math.log(c.worst - c.cap + 1) / Math.log(100) : 0
  if (t <= 0) return 'var(--card)'
  const pct = Math.round(18 + 72 * Math.min(1, t))
  return `color-mix(in oklch, var(--contested) ${pct}%, var(--card))`
}
const darkInk = (c: Cell, metric: Metric) => (metric === 'rate' ? c.over >= 50 : c.worst - c.cap >= 7)

/** How every attempt of a cell ended: one stacked bar with a 2px surface gap between segments. */
export function OutcomeBar({ mix, className }: { mix: Record<Outcome, number>; className?: string }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1
  const parts = (Object.keys(OUTCOME_META) as Outcome[]).filter((k) => mix[k] > 0)
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((k) => (
          <div
            key={k}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', OUTCOME_META[k].className)}
            style={{ width: `${(100 * mix[k]) / total}%`, minWidth: 3 }}
            title={`${OUTCOME_META[k].label}: ${fmtInt(mix[k])}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-sm', OUTCOME_META[k].className)} aria-hidden />
            {OUTCOME_META[k].label}
            <span className="tabular font-medium text-foreground">{((100 * mix[k]) / total).toFixed(mix[k] === total ? 0 : 1)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function CellDetail({ c }: { c: Cell }) {
  const st = STRATEGY[c.s]
  const held = c.over === 0
  return (
    <div className="grid gap-4 rounded-lg bg-muted/40 p-4 ring-1 ring-foreground/5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" data-testid="race-cell-detail">
      <div className="space-y-1">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {c.s} · {ISOS.find((i) => i.id === c.iso)?.name} · N = {c.n}
        </div>
        <div className="text-sm font-medium">{st.name}</div>
        <p className={cn('text-sm', held ? 'text-confirmed' : 'text-contested')}>
          {held
            ? `Held at ${c.cap}/${c.cap} in all ${fmtInt(c.trials)} races: exactly one racer admitted every time.`
            : `Over-admitted in ${c.over}% of ${fmtInt(c.trials)} races; worst ${c.worst}/${c.cap}, on average ${c.meanExcess} too many.`}
        </p>
        <dl className="grid grid-cols-3 gap-2 pt-2 text-xs">
          {[
            ['admitted / race', c.admitted.toFixed(2)],
            ['40001 / race', c.aborts.toFixed(2)],
            ['refused / race', c.refused.toFixed(2)],
            ['retries / attempt', c.retries.toFixed(2)],
            ['p50 latency', `${fmtMs(c.p50)} ms`],
            ['p95 latency', `${fmtMs(c.p95)} ms`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">How all {fmtInt(Object.values(c.mix).reduce((a, b) => a + b, 0))} attempts ended</div>
        <OutcomeBar mix={c.mix} />
      </div>
    </div>
  )
}

/** Strategy × isolation × N: over-admission rate (or worst size) per cell; hover / focus / click for the detail. */
export function RaceHeatmap() {
  const [metric, setMetric] = useState<Metric>('rate')
  const [pinned, setPinned] = useState<Cell | undefined>(() => cellOf('S2', 'RR', 100))
  const [hover, setHover] = useState<Cell | undefined>()
  const shown = hover ?? pinned

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Colour by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'rate', label: 'Over-admission rate' },
            { value: 'worst', label: 'Worst final size' },
          ]}
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
          <span>held at 4/4</span>
          <span className="h-2.5 w-28 rounded-full ring-1 ring-foreground/10" style={{ background: 'linear-gradient(90deg, var(--card), color-mix(in oklch, var(--contested) 90%, var(--card)))' }} />
          <span>{metric === 'rate' ? 'over-admits in 100% of races' : 'worst: 103/4'}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0.5 text-xs" data-testid="race-heatmap">
          <thead>
            <tr>
              <th className="w-56">
                <span className="sr-only">strategy</span>
              </th>
              {ISOS.map((iso) => (
                <th key={iso.id} colSpan={NS.length} className="pb-1 text-center font-medium text-muted-foreground">
                  {iso.name}
                </th>
              ))}
            </tr>
            <tr>
              <th className="pb-1 text-left font-normal text-muted-foreground">strategy \ clients N</th>
              {ISOS.flatMap((iso) =>
                NS.map((n) => (
                  <th key={iso.id + n} className="tabular pb-1 font-normal text-muted-foreground">
                    {n}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {STRATEGIES.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="pr-3 text-left font-normal">
                  <span className="font-mono font-medium">{s.id}</span> <span className="text-muted-foreground">{s.name}</span>
                </th>
                {ISOS.flatMap((iso) =>
                  NS.map((n) => {
                    const c = cellOf(s.id, iso.id, n)
                    if (!c) return <td key={iso.id + n}>–</td>
                    const active = shown === c
                    const held = c.over === 0
                    return (
                      <td key={iso.id + n} className={cn('p-0', n === 2 && 'pl-1.5')}>
                        <button
                          type="button"
                          data-cell={`${c.s}-${c.iso}-${c.n}`}
                          onMouseEnter={() => setHover(c)}
                          onMouseLeave={() => setHover(undefined)}
                          onFocus={() => setHover(c)}
                          onBlur={() => setHover(undefined)}
                          onClick={() => setPinned(c)}
                          aria-pressed={pinned === c}
                          aria-label={`${s.id} ${iso.name} N=${n}: ${held ? 'held at 4/4' : `over-admitted in ${c.over}% of races, worst ${c.worst}/${c.cap}`}`}
                          className={cn(
                            'tabular flex h-11 w-full min-w-14 flex-col items-center justify-center rounded-md ring-1 ring-foreground/8 transition-[box-shadow,transform] outline-none',
                            'hover:ring-2 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'ring-2 ring-foreground/70',
                            darkInk(c, metric) ? 'text-white dark:text-background' : held ? 'text-muted-foreground' : 'text-foreground',
                          )}
                          style={{ background: fill(c, metric) }}
                        >
                          <span className="text-[12.5px] leading-none font-semibold">{metric === 'rate' ? `${c.over}%` : `${c.worst}/${c.cap}`}</span>
                          <span className="pt-0.5 text-[10px] leading-none opacity-75">{metric === 'rate' ? `${c.worst}/${c.cap}` : `${c.over}%`}</span>
                        </button>
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown ? <CellDetail c={shown} /> : null}
    </div>
  )
}
