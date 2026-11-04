import { FileCode2, GitCommitHorizontal, GitBranch } from 'lucide-react'
import { LiveActivityFeed } from '@/components/activity/LiveActivityPanel'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Panel } from '@/components/Panel'
import { PanelSkeleton } from '@/components/Skeletons'
import { useCommitTimeline, type ActivityItem, type CommitGroup, type LiveStatus } from '@/data/activity'
import { formatDateTime, formatRelative } from '@/lib/format'
import { AiBadge } from '../parts/ui'

function CommitCard({ c }: { c: CommitGroup }) {
  const isSha = /^[0-9a-f]{7,40}$/i.test(c.sha)
  return (
    <li className="relative pb-5 pl-8 last:pb-0" data-testid="commit" data-sha={c.sha}>
      <span className="absolute top-1 left-0 flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-card" aria-hidden>
        <GitCommitHorizontal className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-xs font-medium text-brand" title={c.sha}>
            {isSha ? c.sha.slice(0, 7) : c.sha}
          </span>
          <span className="text-sm font-medium">{c.message ?? 'no message'}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {c.name} <span className="font-mono">{c.usn}</span>
          </span>
          <span>·</span>
          <time dateTime={c.at} title={formatDateTime(c.at)}>
            {formatRelative(c.at)}
          </time>
          <AiBadge value={c.ai_assisted ? 'assisted' : 'none'} />
        </p>
        <ul className="mt-2 space-y-0.5">
          {c.files.map((f) => (
            <li key={f.contribution_id} className="flex min-w-0 items-center gap-1.5 text-xs">
              <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-mono" title={f.path ?? f.artifact_title}>
                {f.path ?? f.artifact_title}
              </span>
              <span className="shrink-0 text-muted-foreground">
                → {f.artifact_id} · {f.artifact_type}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}

/** Project page "Activity" tab: the GitHub commit timeline plus the team's live feed. */
export function ActivityTab({
  projectId,
  teamId,
  live,
}: {
  projectId: string
  teamId: string
  live: { status: LiveStatus; items: ActivityItem[] }
}) {
  const timeline = useCommitTimeline(projectId, teamId)
  const commits = timeline.data ?? []
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <Panel
        title="GitHub activity"
        description="Commits pushed to your team's repository, as the ingestion pipeline projected them: one card per commit and author, with the files it touched."
        sqlId="project.activity"
        actions={timeline.isSuccess ? <span className="tabular text-xs text-muted-foreground">{commits.length} commits</span> : null}
      >
        {timeline.isError ? (
          <ErrorState compact error={timeline.error} onRetry={() => void timeline.refetch()} />
        ) : timeline.isPending ? (
          <PanelSkeleton lines={5} />
        ) : commits.length === 0 ? (
          <EmptyState
            compact
            icon={GitBranch}
            title="No recorded GitHub evidence yet"
            description="When your team's repository is registered and someone pushes to its default branch, each commit appears here with its files."
          />
        ) : (
          <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-3 before:w-px before:bg-border" data-testid="commit-timeline">
            {commits.map((c) => (
              <CommitCard key={`${c.sha}:${c.usn}`} c={c} />
            ))}
          </ol>
        )}
      </Panel>
      <LiveActivityFeed
        live={live}
        projectId={projectId}
        teamId={teamId}
        title="Team activity"
        description="Your team's new evidence, live over a private Realtime channel the moment it is recorded."
      />
    </div>
  )
}
