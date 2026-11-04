import { DatabaseZap, GitPullRequestArrow, Loader2, RefreshCw, RotateCw, Scale, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { TraceSheet } from '@/components/activity/TraceSheet'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
import {
  useConsistency,
  useDrainIngest,
  useIngestEvents,
  type ConsistencyAuthor,
  type ConsistencyTeam,
  type IngestEvent,
} from '@/data/admin'
import { API_START_HINT, API_URL, ApiError, isMissingEndpoint, isOffline } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import { toastError } from '@/lib/notify'
import { cn } from '@/lib/utils'

const INGEST_STATUS: Record<string, { label: string; className: string; hint: string }> = {
  queued: { label: 'Queued', className: 'bg-pending-soft text-pending ring-pending/25', hint: 'in the inbox and the pgmq queue' },
  raw_stored: { label: 'Raw stored', className: 'bg-info-soft text-info ring-info/25', hint: 'logged in Mongo, not yet projected' },
  projected: { label: 'Projected', className: 'bg-confirmed-soft text-confirmed ring-confirmed/25', hint: 'rows written to Postgres' },
  failed: { label: 'Failed', className: 'bg-contested-soft text-contested ring-contested/25', hint: 'will be retried after the visibility timeout' },
  ignored: { label: 'Ignored', className: 'bg-muted text-muted-foreground ring-border', hint: 'logged, never queued' },
}

export function IngestStatusChip({ status }: { status: string }) {
  const s = INGEST_STATUS[status] ?? { label: status, className: 'bg-muted text-muted-foreground ring-border', hint: '' }
  return (
    <span
      data-status={status}
      title={s.hint}
      className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset', s.className)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </span>
  )
}

const EVENT_COLUMNS: Column<IngestEvent>[] = [
  {
    key: 'received_at',
    header: 'Received',
    sortValue: (r) => r.received_at,
    cell: (r) => (
      <span className="text-xs" title={formatDateTime(r.received_at)}>
        {formatRelative(r.received_at)}
      </span>
    ),
  },
  {
    key: 'delivery',
    header: 'Delivery',
    cell: (r) => (
      <div className="min-w-0">
        <span className="font-mono text-xs" title={r.delivery_id}>
          {r.delivery_id.length > 18 ? `${r.delivery_id.slice(0, 18)}…` : r.delivery_id}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {r.event_type}
          {r.repo_full_name ? ` · ${r.repo_full_name}` : ''}
        </span>
      </div>
    ),
  },
  { key: 'team', header: 'Team', sortValue: (r) => r.team_id, cell: (r) => <span className="font-mono text-xs">{r.team_id ?? '—'}</span> },
  { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <IngestStatusChip status={r.status} /> },
  {
    key: 'counts',
    header: 'Commits → rows',
    align: 'right',
    cell: (r) => (
      <span className="tabular text-xs">
        {r.commit_count ?? '—'} → {r.contribution_count ?? '—'}
      </span>
    ),
  },
  { key: 'attempts', header: 'Tries', align: 'right', sortValue: (r) => r.attempts, cell: (r) => <span className="tabular text-xs">{r.attempts}</span> },
  {
    key: 'note',
    header: 'Note',
    cell: (r) =>
      r.error ? (
        <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground" title={r.error}>
          {r.error}
        </span>
      ) : r.mongo_id ? (
        <span className="text-[11px] text-muted-foreground">
          Mongo <span className="font-mono">{r.mongo_id.slice(0, 8)}…</span>
        </span>
      ) : null,
  },
]

const CONSISTENCY_STATUS: Record<string, string> = {
  consistent: 'bg-confirmed-soft text-confirmed ring-confirmed/25',
  only_in_mongo: 'bg-pending-soft text-pending ring-pending/25',
  only_in_postgres: 'bg-pending-soft text-pending ring-pending/25',
  mismatch: 'bg-contested-soft text-contested ring-contested/25',
  outside_pipeline: 'bg-muted text-muted-foreground ring-border',
}

type ConsistencyRow = ConsistencyAuthor & { team: ConsistencyTeam }

const CONSISTENCY_COLUMNS: Column<ConsistencyRow>[] = [
  {
    key: 'team',
    header: 'Team',
    sortValue: (r) => r.team.team_id,
    cell: (r) => (
      <span className="text-xs">
        <span className="font-mono">{r.team.team_id}</span> {r.team.team_name}
        <span className="block text-[11px] text-muted-foreground">{r.team.project_id}</span>
      </span>
    ),
  },
  { key: 'usn', header: 'Author', sortValue: (r) => r.usn, cell: (r) => <span className="font-mono text-xs">{r.usn || '—'}</span> },
  {
    key: 'mongo',
    header: 'Mongo commits',
    align: 'right',
    sortValue: (r) => r.mongo_commits,
    cell: (r) => {
      const outside = r.outside_pipeline?.mongo_commits ?? 0
      return (
        <span className="tabular" title={outside ? `includes ${outside} fixture commit(s) that never went through the pipeline` : undefined}>
          {r.mongo_commits}
          {outside ? <span className="block text-[11px] text-muted-foreground">{outside} fixture</span> : null}
        </span>
      )
    },
  },
  {
    key: 'pg',
    header: 'Postgres commits',
    align: 'right',
    sortValue: (r) => r.postgres_commits ?? r.postgres_github_contributions,
    cell: (r) => (
      <span className="tabular" title="distinct commit SHAs; rows = contribution rows, one per (commit, author, artifact), i.e. per tracked file">
        {r.postgres_commits ?? '—'}
        <span className="block text-[11px] text-muted-foreground">{r.postgres_github_contributions} rows</span>
      </span>
    ),
  },
  {
    key: 'matched',
    header: 'Matched commits',
    align: 'right',
    sortValue: (r) => r.matched ?? -1,
    cell: (r) => <span className="tabular text-muted-foreground">{r.matched ?? '—'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    sortValue: (r) => r.status,
    cell: (r) => (
      <span
        data-status={r.status}
        title={
          r.status === 'outside_pipeline'
            ? 'seeded or fixture evidence that never went through the webhook pipeline: not a discrepancy'
            : r.not_projected?.length
              ? `${r.not_projected.length} commit(s) touched no tracked file: nothing to project`
              : undefined
        }
        className={cn(
          'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
          CONSISTENCY_STATUS[r.status] ?? 'bg-muted text-muted-foreground ring-border',
        )}
      >
        {r.status.replaceAll('_', ' ')}
      </span>
    ),
  },
  {
    key: 'diff',
    header: 'Unmatched SHAs',
    cell: (r) => {
      const shas = [...r.only_in_mongo.map((s) => `M ${s.slice(0, 7)}`), ...r.only_in_postgres.map((s) => `P ${s.slice(0, 7)}`)]
      return shas.length ? (
        <span className="font-mono text-[11px] text-muted-foreground" title="M = only in Mongo, P = only in Postgres">
          {shas.slice(0, 4).join(' · ')}
          {shas.length > 4 ? ` +${shas.length - 4}` : ''}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )
    },
  },
]

function ApiOfflineState({ onRetry, busy, missing, what }: { onRetry: () => void; busy: boolean; missing: boolean; what: string }) {
  return (
    <EmptyState
      compact
      icon={WifiOff}
      title={missing ? `This API build has no ${what}` : 'API offline'}
      description={
        <>
          {missing ? `The API at ${API_URL} answered, but not on ${what}.` : `The API at ${API_URL} did not answer.`} The inbox above is read
          straight from Postgres and still works. To start the API locally: <span className="font-mono text-xs">{API_START_HINT}</span>
        </>
      }
      action={
        <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
          <RotateCw className={cn(busy && 'animate-spin')} /> Try again
        </Button>
      }
    />
  )
}

/** Admin: the ingestion inbox, the "Sync now" worker trigger, and the cross-store check. */
export function IngestionPanel() {
  const [trace, setTrace] = useState<string | null>(null)
  const events = useIngestEvents()
  const drain = useDrainIngest()
  const consistency = useConsistency()
  const rows = events.data ?? []
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {})
  const pending = (counts.queued ?? 0) + (counts.raw_stored ?? 0) + (counts.failed ?? 0)

  const syncNow = () =>
    drain.mutate(undefined, {
      onSuccess: (s) => {
        const parts = [
          s.read !== null ? `${s.read} processed` : null,
          s.projected !== null ? `${s.projected} projected` : null,
          s.contributions !== null ? `${s.contributions} contributions` : null,
          s.failed ? `${s.failed} failed` : null,
        ].filter(Boolean)
        toast.success('Queue drained', { description: parts.length ? parts.join(' · ') : 'The worker ran once.' })
      },
      onError: (e) => {
        if (isOffline(e)) toast.error('API offline', { description: `Start it to drain the queue: ${API_START_HINT}` })
        else if (isMissingEndpoint(e)) toast.error('No /ingest/drain on this API', { description: `The API at ${API_URL} has no worker endpoint.` })
        else if (e instanceof ApiError) toast.error('Sync failed', { description: `${e.message} (${e.code})` })
        else toastError(e)
      },
    })

  const consistencyRows: ConsistencyRow[] = (consistency.data?.teams ?? []).flatMap((t) => t.authors.map((a) => ({ ...a, team: t })))
  const emptyTeams = (consistency.data?.teams ?? []).filter((t) => t.authors.length === 0)

  return (
    <div className="space-y-4" id="ingestion">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <GitPullRequestArrow className="size-4 text-muted-foreground" aria-hidden /> Ingestion
          </span>
        }
        description="GitHub webhook → Edge Function → ingest_receive() (inbox row + queue message, one transaction) → worker → Mongo raw log → Postgres projection. One row per delivery id: a redelivery never adds a second."
        sqlId="admin.ingest"
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => void events.refetch()} disabled={events.isFetching} title="Reload the inbox">
              <RefreshCw className={cn(events.isFetching && 'animate-spin')} />
              <span className="sr-only">Reload</span>
            </Button>
            <Button size="sm" onClick={syncNow} disabled={drain.isPending} data-testid="sync-now">
              {drain.isPending ? <Loader2 className="animate-spin" /> : <DatabaseZap />} Sync now
              {pending ? <span className="tabular rounded-full bg-primary-foreground/20 px-1.5 text-xs">{pending}</span> : null}
            </Button>
          </>
        }
        flush
      >
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {Object.keys(INGEST_STATUS).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IngestStatusChip status={s} />
              <span className="tabular">{counts[s] ?? 0}</span>
            </span>
          ))}
        </div>
        <div className="px-5 pb-5" data-testid="ingest-events">
          {events.isError ? (
            <ErrorState compact error={events.error} onRetry={() => void events.refetch()} />
          ) : (
            <DataTable
              columns={EVENT_COLUMNS}
              rows={events.data}
              loading={events.isPending}
              rowKey={(r) => r.delivery_id}
              onRowClick={(r) => {
                if (r.status !== 'ignored') setTrace(r.delivery_id)
              }}
              isRowActive={(r) => r.delivery_id === trace}
              dense
              empty={
                <EmptyState
                  compact
                  icon={GitPullRequestArrow}
                  title="No deliveries yet"
                  description="Replay the fixtures (scripts/replay_webhooks.py) or push to a registered repository."
                />
              }
            />
          )}
        </div>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Scale className="size-4 text-muted-foreground" aria-hidden /> Mongo ↔ Postgres consistency
          </span>
        }
        description="Per team and author: commits the Mongo raw log credits vs distinct commit SHAs of github contribution rows in Postgres, matched by SHA (commits on both sides; rows = one per tracked file). Click an inbox row above to trace one push. Counts and SHAs only, never commit messages."
        sqlId="admin.consistency"
        actions={
          consistency.data ? (
            <span
              data-testid="consistency-overall"
              className={cn(
                'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ring-1 ring-inset',
                consistency.data.all_consistent ? CONSISTENCY_STATUS.consistent : CONSISTENCY_STATUS.mismatch,
              )}
            >
              {consistency.data.all_consistent ? 'all consistent' : 'differences found'}
            </span>
          ) : null
        }
      >
        {consistency.isError ? (
          isOffline(consistency.error) || isMissingEndpoint(consistency.error) ? (
            <ApiOfflineState
              onRetry={() => void consistency.refetch()}
              busy={consistency.isFetching}
              missing={isMissingEndpoint(consistency.error)}
              what="GET /consistency"
            />
          ) : consistency.error instanceof ApiError ? (
            <ErrorState
              compact
              error={{ code: String(consistency.error.status), details: consistency.error.code, message: consistency.error.message }}
              onRetry={() => void consistency.refetch()}
            />
          ) : (
            <ErrorState compact error={consistency.error} onRetry={() => void consistency.refetch()} />
          )
        ) : (
          <>
            <DataTable
              columns={CONSISTENCY_COLUMNS}
              rows={consistency.data ? consistencyRows : undefined}
              loading={consistency.isPending}
              rowKey={(r) => `${r.team.team_id}:${r.usn}`}
              dense
              empty={<EmptyState compact icon={Scale} title="No recorded evidence yet" description="No team has GitHub commits in either store." />}
            />
            {emptyTeams.length && consistencyRows.length ? (
              <p className="pt-3 text-xs text-muted-foreground">
                No recorded evidence yet for {emptyTeams.length} other {emptyTeams.length === 1 ? 'team' : 'teams'} (
                {emptyTeams.map((t) => t.team_id).join(', ')}).
              </p>
            ) : null}
          </>
        )}
      </Panel>
      <TraceSheet target={trace === null ? null : { deliveryId: trace }} onClose={() => setTrace(null)} />
    </div>
  )
}
