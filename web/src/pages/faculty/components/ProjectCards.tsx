import { ClipboardList, FolderKanban, GraduationCap } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { StatusBadge } from '@/components/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useTaughtProjects, type TaughtProject } from '@/data/faculty'
import { formatDate, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<string, string> = {
  active: 'bg-confirmed-soft text-confirmed ring-confirmed/25',
  planned: 'bg-info-soft text-info ring-info/25',
  completed: 'bg-muted text-muted-foreground ring-border',
}

/** Cards for the projects the caller oversees, each linking to its sheet and its marks. */
export function ProjectCards({ emptyHint }: { emptyHint?: string }) {
  const q = useTaughtProjects()
  if (q.isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl p-5 ring-1 ring-foreground/10">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    )
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0) {
    return <EmptyState icon={FolderKanban} title="No projects yet" description={emptyHint ?? 'No project is linked to your account for this term.'} />
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="project-cards">
      {q.data.map((p) => (
        <ProjectCard key={p.projectId} p={p} />
      ))}
    </div>
  )
}

function ProjectCard({ p }: { p: TaughtProject }) {
  return (
    <article className="flex flex-col rounded-xl bg-card ring-1 ring-foreground/10" data-testid={`project-${p.projectId}`}>
      <div className="flex-1 space-y-2 p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{p.projectId}</span>
          <span>·</span>
          <span>{p.courseCode}</span>
          {p.offering ? (
            <span>
              · {p.offering.termId} · section {p.offering.section}
            </span>
          ) : (
            <span title="Practice project: it has no course offering, so the course's faculty teaches it">
              · practice project
            </span>
          )}
          <span
            className={cn(
              'ml-auto inline-flex h-5 items-center rounded-full px-2 font-medium capitalize ring-1 ring-inset',
              STATUS_TONE[p.status] ?? STATUS_TONE.completed,
            )}
          >
            {p.status}
          </span>
        </div>
        <h3 className="text-base font-semibold tracking-tight">{p.title}</h3>
        {p.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p> : null}
        <dl className="grid grid-cols-3 gap-2 pt-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Teams</dt>
            <dd className="tabular font-medium">{p.teams}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Students</dt>
            <dd className="tabular font-medium">{p.students}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last activity</dt>
            <dd className="font-medium">{p.lastActivity ? formatRelative(p.lastActivity) : '—'}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {p.claimsContested > 0 ? <StatusBadge status="contested" label={`${p.claimsContested} contested`} /> : null}
          {p.claimsPending > 0 ? <StatusBadge status="pending" label={`${p.claimsPending} pending countersign`} /> : null}
          {p.teams === 0 ? <StatusBadge status="open" label="No teams yet" /> : null}
          <span className="text-xs leading-5 text-muted-foreground">
            {formatDate(p.startDate)} – {formatDate(p.endDate)}
          </span>
        </div>
      </div>
      <div className="flex gap-2 border-t px-5 py-3">
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link to={`/sheet/${p.projectId}`}>
            <ClipboardList /> {p.isLab ? 'Rubric sheet' : 'Marks sheet'}
          </Link>
        </Button>
        {p.isLab ? (
          <Button asChild size="sm" variant="outline" className="flex-1">
            <Link to={`/marks/${p.projectId}`}>
              <GraduationCap /> Lab CIE marks
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  )
}
