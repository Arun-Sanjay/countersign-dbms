import { GitCommitHorizontal, Radio, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { TraceSheet } from '@/components/activity/TraceSheet'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Panel } from '@/components/Panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectLive, useRecentActivity, type ActivityItem, type LiveStatus } from '@/data/activity'
import { formatDateTime, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS: Record<LiveStatus, { label: string; dot: string; title: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-muted-foreground/50', title: 'Joining the private Realtime channel…' },
  live: { label: 'Live', dot: 'bg-confirmed animate-pulse', title: 'Subscribed: new evidence appears here as it is recorded' },
  denied: { label: 'Not authorised', dot: 'bg-contested', title: 'RLS on realtime.messages refused the join' },
  error: { label: 'Offline', dot: 'bg-contested', title: 'Realtime is not reachable; the list below still loads from Postgres' },
  closed: { label: 'Closed', dot: 'bg-muted-foreground/50', title: 'The channel was closed' },
}

export function LiveStatusChip({ status, testId = 'live-status' }: { status: LiveStatus; testId?: string }) {
  const s = STATUS[status]
  return (
    <span
      data-testid={testId}
      data-status={status}
      title={s.title}
      className="inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground ring-1 ring-border ring-inset"
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  )
}

function FeedRow({ item, onTrace }: { item: ActivityItem; onTrace?: (contributionId: number) => void }) {
  const traceable = Boolean(onTrace) && item.source === 'github'
  const open = () => onTrace?.(item.contribution_id)
  return (
    <li
      data-testid="activity-item"
      data-live={item.live ? 'true' : 'false'}
      data-contribution={item.contribution_id}
      className={cn('flex gap-3 px-1 py-2.5', item.live && 'animate-in fade-in slide-in-from-top-1')}
    >
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
          item.live ? 'bg-brand-soft text-brand' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <GitCommitHorizontal className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="leading-snug">
          <span className="font-medium">{item.name ?? item.usn}</span>{' '}
          <span className="text-muted-foreground">recorded work on</span>{' '}
          {traceable ? (
            <button
              type="button"
              onClick={open}
              data-testid="trace-open"
              title="Trace this push: the Mongo raw event next to the Postgres rows"
              className="font-medium underline decoration-dotted underline-offset-2 hover:text-brand"
            >
              {item.artifact_title ?? item.artifact_id}
            </button>
          ) : (
            <span className="font-medium">{item.artifact_title ?? item.artifact_id}</span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{item.usn}</span>
          <span className="font-mono">{item.artifact_id}</span>
          {item.team_id ? <span className="font-mono">{item.team_id}</span> : null}
          <span>{item.source}</span>
          <time dateTime={item.occurred_at} title={formatDateTime(item.occurred_at)}>
            {formatRelative(item.occurred_at)}
          </time>
          {item.live ? (
            <span className="rounded-full bg-brand-soft px-1.5 text-[11px] font-medium text-brand">new</span>
          ) : null}
        </p>
      </div>
    </li>
  )
}

/**
 * Live activity for a project (staff: channel project:<id>) or one team (students: channel
 * team:<id>), the latest contributions from Postgres below. Metadata only. Staff can open a
 * GitHub item to trace its push (the Mongo raw event next to the Postgres rows).
 */
interface FeedProps {
  projectId: string
  teamId?: string
  title?: string
  description?: string
  className?: string
  limit?: number
}

export function LiveActivityPanel(props: FeedProps) {
  const live = useProjectLive(props.projectId, { teamId: props.teamId })
  return <LiveActivityFeed {...props} live={live} />
}

/** The feed itself, for a page that already holds the subscription (useProjectLive). */
export function LiveActivityFeed({
  projectId,
  teamId,
  title = 'Live activity',
  description,
  className,
  limit = 10,
  live,
}: FeedProps & { live: { status: LiveStatus; items: ActivityItem[] } }) {
  const recent = useRecentActivity(projectId, teamId, limit)
  const { profile } = useAuth()
  // staff may open the push behind an item (GET /ingest/trace: admins / teaching faculty)
  const canTrace = profile?.role === 'faculty' || profile?.role === 'admin'
  const [trace, setTrace] = useState<number | null>(null)
  const liveIds = new Set(live.items.map((i) => i.contribution_id))
  const items = [...live.items, ...(recent.data ?? []).filter((r) => !liveIds.has(r.contribution_id))].slice(0, Math.max(limit, live.items.length))

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Radio className="size-4 text-muted-foreground" aria-hidden /> {title}
        </span>
      }
      description={
        description ??
        'New evidence arrives over a private Realtime channel the moment it is recorded: who, which artifact, when. Never the text.'
      }
      actions={<LiveStatusChip status={live.status} />}
      sqlId="activity.live"
      className={className}
    >
      <div data-testid="activity-feed" aria-live="polite">
        {live.status === 'denied' && items.length === 0 ? (
          <EmptyState
            compact
            icon={ShieldOff}
            title="No activity visible to you"
            description={`Row-level security on realtime.messages refused the channel ${teamId ? `team:${teamId}` : `project:${projectId}`}, and the contribution rows are hidden too.`}
          />
        ) : recent.isError && live.items.length === 0 ? (
          <ErrorState compact error={recent.error} onRetry={() => void recent.refetch()} />
        ) : recent.isPending && live.items.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={GitCommitHorizontal}
            title="No recorded evidence yet"
            description="Commits pushed to a registered repository show up here as soon as the worker projects them."
          />
        ) : (
          <ol className="-my-1 divide-y">
            {items.map((i) => (
              <FeedRow key={i.contribution_id} item={i} onTrace={canTrace ? setTrace : undefined} />
            ))}
          </ol>
        )}
      </div>
      {canTrace ? <TraceSheet target={trace === null ? null : { contributionId: trace }} onClose={() => setTrace(null)} /> : null}
    </Panel>
  )
}
