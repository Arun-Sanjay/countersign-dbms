import { ChevronRight, Flag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { SqlButton } from '@/components/sql/SqlButton'
import { SqlCode } from '@/components/sql/SqlCode'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { parseSchedule } from '@/lib/precedence'
import { cn } from '@/lib/utils'
import { fmtInt, ISOS, pooledOver, RESULTS, STRATEGIES, type IsoId, type Strategy, type StrategyId } from '@/pages/race/data'
import { LatencyChart } from '@/pages/race/LatencyChart'
import { LiveRacePanel } from '@/pages/race/LiveRacePanel'
import { ScheduleExplainer } from '@/pages/race/PrecedenceView'
import { RaceHeatmap } from '@/pages/race/RaceHeatmap'
import raceResults from '@/data/race-results.json'

const { meta } = RESULTS

function StrategyCard({ s }: { s: Strategy }) {
  const [open, setOpen] = useState(false)
  const sources = raceResults.sql[s.id]
  const main = sources[0]
  return (
    <article className="relative flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-testid={`strategy-${s.id}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 items-center rounded-md bg-brand-soft px-1.5 font-mono text-xs font-semibold text-brand">{s.id}</span>
            <h3 className="truncate text-sm font-semibold tracking-tight">{s.name}</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {s.kind === 'declarative' ? 'Declarative' : 'Procedural'} · {s.where}
          </p>
        </div>
        <SqlButton panelId={s.sqlId} />
      </header>
      <p className="text-sm text-pretty">{s.line}</p>
      <div className="flex flex-wrap gap-1.5">
        {ISOS.map((iso) => {
          const pct = pooledOver(s.id, iso.id)
          return (
            <span
              key={iso.id}
              title={`${iso.name}: over-admitted in ${pct.toFixed(1)}% of ${fmtInt(4 * meta.trialsPerCell)} races (all N)`}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium ring-1 ring-inset',
                pct > 0 ? 'bg-contested-soft text-contested ring-contested/20' : 'bg-confirmed-soft text-confirmed ring-confirmed/20',
              )}
            >
              {iso.id} <span className="tabular">{pct > 0 ? `over-admits ${pct.toFixed(0)}%` : 'held'}</span>
            </span>
          )
        })}
      </div>
      {main ? (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-auto">
          <CollapsibleTrigger className="flex w-full items-start gap-1 text-left text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('mt-px size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
            <span className="min-w-0">
              <span className="font-medium">{main.label}</span> <span className="break-words">· {main.file}</span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <SqlCode code={main.sql} lineNumbers={false} maxHeight="18rem" />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </article>
  )
}

function Example({ s, iso, title, blurb, testId }: { s: StrategyId; iso: IsoId; title: string; blurb: string; testId: string }) {
  const ex = RESULTS.examples.find((e) => e.s === s && e.iso === iso)
  const ops = useMemo(() => (ex ? parseSchedule(ex.schedule) : []), [ex])
  if (!ex) return null
  return (
    <div className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" data-testid={testId}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <Badge variant="outline" className="font-mono text-[11px] font-normal">
            {s} · {ISOS.find((i) => i.id === iso)?.name} · run {ex.runId} · {ex.finalSize}/{ex.cap}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </div>
      <ScheduleExplainer ops={ops} idPrefix={testId} />
      <p className="text-xs text-muted-foreground">
        analysis.sql said: <span className="font-mono">{ex.sql.verdict}</span>, edges <span className="font-mono">{ex.sql.edges}</span>
        {ex.sql.cycleInclAborted ? (
          <>
            , incl. aborted <span className="font-mono">{ex.sql.cycleInclAborted}</span>
          </>
        ) : null}
        . The page recomputes the graph with the same rules; the build fails if the two disagree.
      </p>
    </div>
  )
}

/** /race: the Innovative Experiment (Component 10) inside the product. */
export default function RacePage() {
  const s2rr = RESULTS.cells.filter((c) => c.s === 'S2' && c.iso === 'RR')
  const s2Admitted = s2rr.reduce((a, c) => a + c.mix.admitted, 0)
  const s2Attempts = s2rr.reduce((a, c) => a + Object.values(c.mix).reduce((x, y) => x + y, 0), 0)
  const s2Worst = Math.max(...s2rr.map((c) => c.worst))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Component 10 · Innovative Experiment"
        title="Race arena: the last team slot"
        description={`Team Beta (${meta.team}) has max_size ${meta.capacity} and ${meta.capacity - 1} members: exactly one free seat. N students try to take it at the same moment. Six ways of enforcing the capacity rule, at PostgreSQL's three isolation levels: does the team ever end up above ${meta.capacity}/${meta.capacity}?`}
        meta={
          <>
            <Badge variant="secondary" className="tabular font-normal">
              {fmtInt(meta.races)} races
            </Badge>
            <Badge variant="secondary" className="tabular font-normal">
              {fmtInt(meta.attempts)} attempts
            </Badge>
            <Badge variant="secondary" className="tabular font-normal">
              {fmtInt(meta.trialsPerCell)} trials × {meta.cells} cells
            </Badge>
            {meta.postgres ? (
              <Badge variant="secondary" className="font-normal">
                PostgreSQL {meta.postgres}
              </Badge>
            ) : null}
            {meta.window ? <span className="text-xs text-muted-foreground">run {meta.window}</span> : null}
          </>
        }
        actions={
          <a href="#live" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Flag className="size-4" /> Run a live race
          </a>
        }
      />

      <section className="rounded-xl bg-contested-soft/60 p-5 ring-1 ring-contested/15" data-testid="race-headline">
        <p className="text-xs font-medium tracking-wide text-contested uppercase">Headline</p>
        <p className="pt-1 text-lg font-semibold tracking-tight text-balance">A correct-looking lock-then-check trigger is only correct at READ COMMITTED.</p>
        <p className="pt-1 text-sm text-pretty text-muted-foreground">
          The graded fixture's trigger (S2, Q35) over-admitted in every one of {fmtInt(s2rr.reduce((a, c) => a + c.trials, 0))} races at REPEATABLE READ:{' '}
          {fmtInt(s2Admitted)} of {fmtInt(s2Attempts)} racers were admitted and the worst race ended at {s2Worst}/{meta.capacity}. SERIALIZABLE alone fixes
          all six strategies; what makes a procedural rule safe at every level is turning the conflict into a write on one row (S3, S7) or a key (S6).
        </p>
      </section>

      <Panel
        title="Over-admission matrix: strategy × isolation × N"
        description={`Each cell is ${fmtInt(meta.trialsPerCell)} races. Hover or focus a cell for how its attempts ended; click to keep it.`}
        sqlId="race.matrix"
      >
        <RaceHeatmap />
      </Panel>

      <Panel title="Latency: p95 per strategy" description="What each guarantee costs, per isolation level. Hover for every strategy's value at that N." sqlId="race.matrix">
        <LatencyChart />
      </Panel>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">The six strategies</h2>
          <p className="text-sm text-muted-foreground">
            Only one is active at a time (exp.use_strategy). The chips pool all N. There is no S5: the numbering follows docs/PLAN.md.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="strategy-cards">
          {STRATEGIES.map((s) => (
            <StrategyCard key={s.id} s={s} />
          ))}
        </div>
      </section>

      <Panel
        title="Worked example: precedence graphs of two N = 2 races"
        description="Each race's LOGICAL, client-recorded schedule (reads placed at the snapshot they used). An edge Ti → Tj means an operation of Ti precedes a conflicting one of Tj: same item, at least one write. Acyclic ⇔ conflict-serializable."
        sqlId="race.precedence"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Example
            s="S2"
            iso="RR"
            title="Cyclic: the trigger at REPEATABLE READ"
            blurb="Both read the member set with snapshots taken before either insert, and both committed: T1 → T2 → T1. The team ended at 5/4."
            testId="example-cyclic"
          />
          <Example
            s="S2"
            iso="RC"
            title="Acyclic: the same trigger at READ COMMITTED"
            blurb="T1 waited for the team-row lock, then counted with a fresh snapshot that saw T2's insert, and was refused. One edge, T2 → T1: serial order T2, T1."
            testId="example-acyclic"
          />
        </div>
        <p className="pt-4 text-xs text-muted-foreground">
          A consistency check of the model, not independent evidence: a race that held at 4/4 commits one transaction, so its committed graph is
          acyclic by construction. In all {fmtInt(RESULTS.serializability.reduce((a, r) => a + r.runs, 0))} N = 2 races the verdict matched the outcome (
          {fmtInt(RESULTS.serializability.reduce((a, r) => a + r.verdictMatches, 0))} of them). Full method: experiments/race/README.md, “Logical schedule”.
        </p>
      </Panel>

      <div id="live" className="scroll-mt-6">
        <Panel
          title="Run a live race"
          description="One race, now, in the race lab (docker container elp-race-pg, port 55433), with the harness's own code through the API. The outcome varies with timing; the matrix above is the reported result."
          sqlId="race.live"
        >
          <LiveRacePanel />
        </Panel>
      </div>
    </div>
  )
}
