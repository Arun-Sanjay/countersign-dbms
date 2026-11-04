import { Database, FileJson, GitCommitHorizontal, WifiOff } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { SqlButton } from '@/components/sql/SqlButton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useTrace, type TraceResponse, type TraceTarget } from '@/data/trace'
import { API_START_HINT, ApiError, isMissingEndpoint, isOffline } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—')

/** One key-value row. `id`: an opaque identifier (delivery id, ObjectId), which may break
 *  anywhere; every other value wraps only between words. */
function Kv({ k, v, mono = true, id = false }: { k: string; v: React.ReactNode; mono?: boolean; id?: boolean }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
      <dd className={cn('min-w-0', id ? 'break-all' : 'break-words', mono && 'font-mono')}>{v ?? '—'}</dd>
    </div>
  )
}

function Halves({ data }: { data: TraceResponse }) {
  const ev = data.postgres?.ingest_event
  const mongo = data.mongo
  return (
    <div className="space-y-4">
      {/* two cards side by side only when the sheet itself is at least 40rem wide (container query) */}
      <div className="grid gap-3 @min-[40rem]:grid-cols-2">
        <section className="rounded-lg p-3 ring-1 ring-border" data-testid="trace-mongo">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <FileJson className="size-3.5" aria-hidden /> MongoDB · elp.github_events
          </h3>
          {mongo ? (
            <dl className="space-y-1">
              <Kv k="_id" v={mongo['_id']} id />
              <Kv k="repo · ref" v={`${mongo.repo} · ${mongo.ref ?? '—'}`} />
              <Kv k="after" v={short(mongo.after)} />
              <Kv k="sender" v={mongo.sender} />
              <Kv k="logged_at" v={mongo.logged_at ? formatDateTime(mongo.logged_at) : null} mono={false} />
              <Kv k="unattributed" v={mongo.unattributed_commits.length ? mongo.unattributed_commits.map((c) => short(c.sha)).join(' ') : 'none'} />
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">No raw event in the log for this delivery (only in Postgres).</p>
          )}
        </section>
        <section className="rounded-lg p-3 ring-1 ring-border" data-testid="trace-postgres">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <Database className="size-3.5" aria-hidden /> Postgres · ingest_event
          </h3>
          {ev ? (
            <dl className="space-y-1">
              <Kv k="delivery_id" v={ev.delivery_id} id />
              <Kv k="status" v={`${ev.status}${ev.followups_at ? ' · follow-ups done' : ''}`} mono={false} />
              <Kv k="pushed by" v={ev.sender_login} />
              <Kv k="received" v={formatDateTime(ev.received_at)} mono={false} />
              <Kv k="mongo_id" v={ev.mongo_id} id />
              <Kv k="commits → rows" v={`${ev.commit_count ?? '—'} → ${ev.contribution_count ?? '—'}`} />
              <Kv k="versions" v={data.postgres?.artifact_versions.map((v) => `${v.artifact_id}@v${v.version_no}`).join(' ') || 'none'} />
            </dl>
          ) : null}
        </section>
      </div>
      <section>
        <h3 className="mb-2 text-xs font-semibold">Per commit: raw log ⇄ contribution rows (matched by SHA)</h3>
        <ol className="space-y-2" data-testid="trace-commits">
          {(data.commits ?? []).map((c) => (
            <li key={c.sha} className="rounded-lg p-2.5 text-xs ring-1 ring-border" data-testid="trace-commit" data-status={c.status}>
              <p className="flex flex-wrap items-center gap-2">
                <GitCommitHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono font-semibold">{short(c.sha)}</span>
                <span className="font-mono">{c.author_usn}</span>
                {c.committed_at ? <span className="text-muted-foreground">{formatDateTime(c.committed_at)} (author's clock)</span> : null}
                <span
                  className={cn(
                    'rounded-full px-1.5 font-medium',
                    c.status === 'matched' ? 'bg-confirmed-soft text-confirmed' : 'bg-pending-soft text-pending',
                  )}
                >
                  {c.status === 'matched' ? `${c.postgres_contributions.length} row(s)` : 'no rows (untracked files)'}
                </span>
              </p>
              <ul className="mt-1.5 space-y-0.5 pl-5">
                {c.postgres_contributions.map((k) => (
                  <li key={k.contribution_id} className="font-mono text-[11px] text-muted-foreground">
                    contribution {k.contribution_id} · {k.artifact_id} · {k.artifact.external_ref ?? k.artifact.title}
                  </li>
                ))}
                {c.postgres_contributions.length === 0
                  ? c.files.slice(0, 5).map((f) => (
                      <li key={f} className="font-mono text-[11px] text-muted-foreground">
                        {f}
                      </li>
                    ))
                  : null}
              </ul>
            </li>
          ))}
        </ol>
      </section>
      {data.queries ? (
        <details className="rounded-lg p-3 text-xs ring-1 ring-border">
          <summary className="cursor-pointer font-medium">Show the SQL / Mongo query that ran</summary>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap">{[...data.queries.postgres, data.queries.mongo].join('\n\n')}</pre>
        </details>
      ) : null}
    </div>
  )
}

/** A side sheet: the push behind a live-feed item (contribution) or an inbox row (delivery). */
export function TraceSheet({ target, onClose }: { target: TraceTarget | null; onClose: () => void }) {
  const trace = useTrace(target)
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        // the variant prefix matters: the base SheetContent class sets data-[side=right]:sm:max-w-sm,
        // which beats a plain sm:max-w-2xl (KNOWN_ISSUES #1); SqlSheet uses the same prefix
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:xl:max-w-3xl"
        data-testid="trace-sheet"
        // focus the sheet itself, not its first button (whose tooltip would swallow Escape)
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Trace this push <SqlButton panelId="ingest.trace" />
          </SheetTitle>
          <SheetDescription>
            The raw event in MongoDB next to the rows the projection wrote in Postgres. Metadata only: no commit messages, no file text.
          </SheetDescription>
        </SheetHeader>
        <div className="@container px-4 pb-6">
          {trace.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : trace.isError ? (
            isOffline(trace.error) || isMissingEndpoint(trace.error) ? (
              <EmptyState compact icon={WifiOff} title="API offline" description={`Start it to trace a push: ${API_START_HINT}`} />
            ) : trace.error instanceof ApiError ? (
              <ErrorState compact error={{ code: String(trace.error.status), details: trace.error.code, message: trace.error.message }} />
            ) : (
              <ErrorState compact error={trace.error} />
            )
          ) : trace.data && !trace.data.pipeline ? (
            <EmptyState compact icon={Database} title="Not from the pipeline" description={trace.data.note ?? ''} />
          ) : trace.data ? (
            <Halves data={trace.data} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
