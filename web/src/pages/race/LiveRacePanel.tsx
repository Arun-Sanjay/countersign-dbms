import { Flag, Loader2, Lock, RotateCw, Server, WifiOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { API_START_HINT, API_URL, ApiError, isMissingEndpoint, isOffline } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  cellOf,
  fmtMs,
  ISOS,
  NS,
  OUTCOME_META,
  RACE_LAB_START,
  STRATEGIES,
  STRATEGY,
  useLiveRace,
  type IsoId,
  type LiveClient,
  type LiveRace,
  type Outcome,
  type StrategyId,
} from '@/pages/race/data'
import { ScheduleExplainer } from '@/pages/race/PrecedenceView'
import { Segmented } from '@/pages/race/Segmented'

const REVEAL_MS = 1400

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Reveal the clients' outcomes one by one, in the order they finished (by latency). */
function useReveal(result: LiveRace | undefined): Set<number> {
  const [tick, setTick] = useState<{ of: LiveRace | undefined; count: number }>({ of: undefined, count: 0 })
  const order = useMemo(() => (result ? [...result.clients].sort((a, b) => a.latency_ms - b.latency_ms).map((c) => c.client_no) : []), [result])
  const instant = prefersReducedMotion()
  useEffect(() => {
    if (!result || instant) return
    const step = Math.max(12, REVEAL_MS / Math.max(1, order.length))
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setTick({ of: result, count: i })
      if (i >= order.length) window.clearInterval(id)
    }, step)
    return () => window.clearInterval(id)
  }, [result, order, instant])
  const count = !result ? 0 : instant ? order.length : tick.of === result ? tick.count : 0
  return useMemo(() => new Set(order.slice(0, count)), [order, count])
}

function dotSize(n: number) {
  return n <= 8 ? 'size-11 text-[11px]' : n <= 32 ? 'size-7 text-[10px]' : 'size-[18px] text-[0px]'
}

function ClientDot({ c, n, revealed, running }: { c?: LiveClient; n: number; revealed: boolean; running: boolean }) {
  const outcome: Outcome | null = c && revealed ? c.outcome : null
  return (
    <li
      className={cn(
        'flex items-center justify-center rounded-full font-mono font-medium ring-1 ring-foreground/10 transition-colors duration-300',
        dotSize(n),
        outcome ? cn(OUTCOME_META[outcome].className, outcome === 'refused' ? 'text-foreground' : 'text-white dark:text-background') : 'bg-muted text-muted-foreground',
        running && 'animate-pulse',
      )}
      title={c ? `client ${c.client_no}: ${OUTCOME_META[c.outcome].label}${c.sqlstate ? ` (${c.sqlstate})` : ''} · ${fmtMs(c.latency_ms)} ms${c.retries ? ` · ${c.retries} retries` : ''}` : undefined}
      data-outcome={outcome ?? undefined}
    >
      {c?.client_no ?? ''}
    </li>
  )
}

/** T02's seats: the 3 seeded members, the one free seat, and any seat beyond max_size. */
function Seats({ result, revealedAdmitted }: { result?: LiveRace; revealedAdmitted: number }) {
  const cap = result?.max_size ?? 4
  const seeded = cap - 1
  const taken = result ? Math.min(revealedAdmitted, result.final_size - seeded) : 0
  const total = Math.max(cap, seeded + taken)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1" aria-label={`Team T02: ${seeded + taken} of ${cap} seats`}>
        {Array.from({ length: total }, (_, i) => {
          const kind = i < seeded ? 'seeded' : i < seeded + taken ? (i < cap ? 'won' : 'over') : 'free'
          return (
            <span
              key={i}
              className={cn(
                'flex h-7 w-9 items-center justify-center rounded-md text-[10px] font-medium ring-1',
                kind === 'seeded' && 'bg-muted text-muted-foreground ring-foreground/10',
                kind === 'won' && 'bg-brand text-brand-foreground ring-brand',
                kind === 'over' && 'bg-contested text-white ring-contested dark:text-background',
                kind === 'free' && 'border border-dashed border-foreground/25 text-muted-foreground ring-transparent',
                i === cap && 'ml-2',
              )}
            >
              {i + 1}
            </span>
          )
        })}
      </div>
      <div className="text-xs text-muted-foreground">
        Team Beta (T02): seats 1–{cap - 1} seeded members, seat {cap} the one free seat
        {total > cap ? (
          <span className="text-contested">; {total === cap + 1 ? `seat ${total} should not exist` : `seats ${cap + 1}–${total} should not exist`}</span>
        ) : null}
      </div>
    </div>
  )
}

function Problem({ error, onRetry, busy }: { error: Error; onRetry: () => void; busy: boolean }) {
  const retry = (
    <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
      <RotateCw className={cn(busy && 'animate-spin')} /> Try again
    </Button>
  )
  if (error instanceof ApiError && error.code === 'race_lab_offline') {
    return (
      <EmptyState
        compact
        icon={Server}
        title="Race lab offline"
        description={
          <>
            {error.message} Start it from the repository root:
            <code className="mt-2 block rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{RACE_LAB_START}</code>
          </>
        }
        action={retry}
      />
    )
  }
  if (isOffline(error) || isMissingEndpoint(error)) {
    return (
      <EmptyState
        compact
        icon={WifiOff}
        title={isMissingEndpoint(error) ? 'This API build has no POST /race/run' : 'API offline'}
        description={
          <>
            The API at {API_URL} {isMissingEndpoint(error) ? 'answered, but not on /race/run' : 'did not answer'}. The reported results above
            are built into the page and still work. To start the API: <span className="font-mono text-xs">{API_START_HINT}</span>
          </>
        }
        action={retry}
      />
    )
  }
  const busyRace = error instanceof ApiError && error.code === 'race_busy'
  return (
    <div role="alert" className={cn('rounded-lg px-3 py-2 text-sm ring-1', busyRace ? 'bg-pending-soft text-pending ring-pending/20' : 'bg-destructive/5 text-destructive ring-destructive/20')}>
      {error.message}
      {error instanceof ApiError ? <span className="pl-2 font-mono text-xs opacity-80">{error.code}</span> : null}
    </div>
  )
}

/** "Run a live race": POST /race/run, then animate the N clients' outcomes. */
export function LiveRacePanel() {
  const profile = useProfile()
  const canRun = profile.role === 'faculty' || profile.role === 'admin'
  const [strategy, setStrategy] = useState<StrategyId>('S2')
  const [iso, setIso] = useState<IsoId>('RR')
  const [n, setN] = useState<number>(8)
  const race = useLiveRace()
  const result = race.data
  const shown = useReveal(result)
  const reported = cellOf(strategy, iso, n)
  const done = result ? shown.size >= result.clients.length : false
  const revealedAdmitted = result ? result.clients.filter((c) => c.outcome === 'admitted' && shown.has(c.client_no)).length : 0
  const shownN = result?.n ?? n
  const byNo = new Map((result?.clients ?? []).map((c) => [c.client_no, c]))

  const run = () => race.mutate({ strategy, isolation: iso, n })
  const stale = result && (result.strategy !== strategy || result.isolation !== iso || result.n !== n)

  return (
    <div className="space-y-5" data-testid="live-race">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Strategy</span>
          <Select value={strategy} onValueChange={(v) => setStrategy(v as StrategyId)}>
            <SelectTrigger className="w-64" aria-label="Strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="font-mono">{s.id}</span> {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Isolation</span>
          <Segmented label="Isolation level" value={iso} onChange={setIso} options={ISOS.map((i) => ({ value: i.id, label: i.id, title: i.name }))} />
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Clients N</span>
          <Segmented
            label="Clients"
            value={String(n)}
            onChange={(v) => setN(Number(v))}
            options={NS.map((x) => ({ value: String(x), label: <span className="tabular">{x}</span> }))}
          />
        </div>
        <Button onClick={run} disabled={!canRun || race.isPending} data-testid="run-race" className="h-9">
          {race.isPending ? <Loader2 className="animate-spin" /> : canRun ? <Flag /> : <Lock />} Run race
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {STRATEGY[strategy].line}{' '}
        {reported ? (
          <span className={reported.over ? 'text-contested' : 'text-confirmed'}>
            Reported for this cell: {reported.over ? `over-admitted in ${reported.over}% of ${reported.trials} races (worst ${reported.worst}/${reported.cap})` : `held at 4/4 in all ${reported.trials} races`}.
          </span>
        ) : null}
      </p>
      {!canRun ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="race-staff-only">
          Live races are for faculty and admins: POST /race/run checks your role. The reported results above are the same for everyone.
        </p>
      ) : null}

      {race.isError ? <Problem error={race.error} onRetry={run} busy={race.isPending} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <div className="pb-2 text-xs font-medium text-muted-foreground">
              {shownN} clients race for the one free seat{race.isPending ? ' (running…)' : result ? ` · ${result.isolation_name} · ${result.strategy}` : ''}
            </div>
            <ol className="flex flex-wrap gap-1.5" data-testid="race-clients">
              {Array.from({ length: shownN }, (_, i) => (
                <ClientDot key={i} c={byNo.get(i + 1)} n={shownN} revealed={shown.has(i + 1)} running={race.isPending} />
              ))}
            </ol>
          </div>
          <Seats result={result} revealedAdmitted={revealedAdmitted} />
        </div>

        <div className="space-y-3">
          {result ? (
            <>
              <dl className="grid grid-cols-4 gap-2" data-testid="race-result">
                {[
                  ['admitted', result.admitted, 'text-brand'],
                  ['refused', result.refused, 'text-muted-foreground'],
                  ['aborted', result.aborted, 'text-pending'],
                  ['errors', result.errors, 'text-contested'],
                ].map(([k, v, cls]) => (
                  <div key={k as string} className="rounded-lg p-2.5 ring-1 ring-foreground/10">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className={cn('tabular text-xl font-semibold', done ? (cls as string) : 'text-muted-foreground/50')}>{done ? (v as number) : '·'}</dd>
                  </div>
                ))}
              </dl>
              <div
                className={cn(
                  'rounded-lg px-3 py-2 text-sm ring-1 transition-opacity',
                  done ? 'opacity-100' : 'opacity-0',
                  result.over_admitted ? 'bg-contested-soft text-contested ring-contested/20' : 'bg-confirmed-soft text-confirmed ring-confirmed/20',
                )}
                data-testid="race-final-size"
              >
                <span className="tabular font-semibold">
                  Final size {result.final_size}/{result.max_size}
                </span>
                {result.over_admitted ? `: over-admitted by ${result.final_size - result.max_size}. ` : ': the rule held. '}
                <span className="text-muted-foreground">
                  {result.aborts_40001 ? `${result.aborts_40001} × 40001 seen` : 'no 40001'}
                  {result.retries ? `, ${result.retries} retries` : ''} · {fmtMs(result.duration_ms)} ms · {result.lab}
                </span>
              </div>
              {stale ? <p className="text-xs text-muted-foreground">These are the results of the previous settings; press Run race to race again.</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Press <span className="font-medium text-foreground">Run race</span> to run one race in the race lab (docker container elp-race-pg) with the
              harness's own code. T02 is reset to 3/4 before and after; nothing is added to the reported results.
            </p>
          )}
        </div>
      </div>

      {result?.schedule && done ? (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold tracking-tight">This race's precedence graph (N = 2)</h3>
          <ScheduleExplainer ops={result.schedule} idPrefix="live" testId="live-precedence" />
        </div>
      ) : null}
    </div>
  )
}
