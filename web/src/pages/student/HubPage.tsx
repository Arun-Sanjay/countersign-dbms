import { ArrowRight, BookOpen, CalendarClock, GraduationCap, PenLine, Signature, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PanelSkeleton, StatGridSkeleton } from '@/components/Skeletons'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLiveProjects, useMyEvidenceProjects, useSemesterHub, useUpcomingMilestones } from '@/data/hub'
import type { HubCourse, SemesterHubStudent } from '@/data/types'
import { componentLabel, firstName, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SectionHeader } from './parts/SectionHeader'
import { countdownLabel, daysUntil } from './parts/time'
import { ClaimCounts, CountdownChip } from './parts/ui'

interface OfferingGroup {
  offering_id: number
  course_code: string
  course_title: string
  faculty_name: string
  section: string
  term_id: string
  current: boolean
  projects: HubCourse[]
}

function groupByOffering(courses: HubCourse[]): OfferingGroup[] {
  const map = new Map<number, OfferingGroup>()
  for (const c of courses) {
    const id = c.offering_id ?? -1
    let g = map.get(id)
    if (!g) {
      g = {
        offering_id: id,
        course_code: c.course_code ?? '',
        course_title: c.course_title ?? '',
        faculty_name: c.faculty_name ?? '',
        section: c.section ?? '',
        term_id: c.term_id ?? '',
        current: Boolean(c.is_current_term),
        projects: [],
      }
      map.set(id, g)
    }
    if (c.project_id) g.projects.push(c)
  }
  for (const g of map.values()) {
    // my teams first, then the newest project (P06 before the fixture's P01)
    g.projects.sort((a, b) => Number(Boolean(b.team_id)) - Number(Boolean(a.team_id)) || (b.project_id ?? '').localeCompare(a.project_id ?? ''))
  }
  return [...map.values()]
}

/** /hub — semester hub: courses, projects, next deadlines, countersign queue. */
export default function HubPage() {
  const profile = useProfile()
  const hubQuery = useSemesterHub()
  const hub = hubQuery.data?.role === 'student' ? (hubQuery.data as SemesterHubStudent) : undefined

  const groups = useMemo(() => groupByOffering(hub?.courses ?? []), [hub])
  const current = groups.filter((g) => g.current)
  const earlier = groups.filter((g) => !g.current)
  const allProjectIds = (hub?.courses ?? []).map((c) => c.project_id).filter((id): id is string => Boolean(id))
  const live = useLiveProjects(allProjectIds)
  const evidence = useMyEvidenceProjects(profile.usn)
  const isLive = (id: string | null | undefined) => Boolean(id && live.data?.has(id))
  // the live lab (attached to an offering, e.g. P06) before the practice projects
  const myCurrentProjects = current
    .flatMap((g) => g.projects)
    .filter((p) => p.team_id)
    .sort((a, b) => Number(isLive(b.project_id)) - Number(isLive(a.project_id)))
  const myLiveProjects = myCurrentProjects.filter((p) => isLive(p.project_id))
  const firstTeamProject = myCurrentProjects[0]?.project_id
  const [showPractice, setShowPractice] = useState(false)

  const totals = useMemo(() => {
    const seen = new Set<string>()
    let pending = 0
    let confirmed = 0
    let contested = 0
    for (const c of hub?.courses ?? []) {
      if (!c.project_id || seen.has(c.project_id)) continue
      seen.add(c.project_id)
      pending += c.my_claims_pending ?? 0
      confirmed += c.my_claims_confirmed ?? 0
      contested += c.my_claims_contested ?? 0
    }
    return { pending, confirmed, contested }
  }, [hub])

  const nextDue = (myLiveProjects.length ? myLiveProjects : myCurrentProjects)
    .filter((p) => p.next_deadline)
    .sort((a, b) => (a.next_deadline ?? '').localeCompare(b.next_deadline ?? ''))[0]

  const practiceIds = myCurrentProjects.filter((p) => !isLive(p.project_id)).map((p) => p.project_id!)
  const timelineIds = (myLiveProjects.length && !showPractice ? myLiveProjects : myCurrentProjects).map((p) => p.project_id!).filter(Boolean)
  const timeline = useUpcomingMilestones(timelineIds, 8)
  const titleOf = (projectId: string) => myCurrentProjects.find((p) => p.project_id === projectId)?.project_title ?? projectId

  return (
    <>
      <PageHeader
        eyebrow="Semester hub"
        title={`Welcome back, ${firstName(profile.displayName)}`}
        description="Your courses this term, your team in each project, what is due next, and the claims waiting for your countersign."
        meta={
          hub ? (
            <>
              {hub.current_term ? (
                <Badge variant="secondary">
                  <CalendarClock /> {hub.current_term.name}
                </Badge>
              ) : null}
              {hub.me ? (
                <Badge variant="outline">
                  {hub.me.usn} · Semester {hub.me.semester} · Section {hub.me.section}
                </Badge>
              ) : null}
            </>
          ) : null
        }
      />

      {hubQuery.isError ? (
        <ErrorState error={hubQuery.error} onRetry={() => hubQuery.refetch()} />
      ) : hubQuery.isPending || !hub ? (
        <div className="space-y-6">
          <StatGridSkeleton />
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <PanelSkeleton lines={5} />
            <PanelSkeleton lines={5} />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ---------- at a glance ---------- */}
          <section>
            <SectionHeader
              title="At a glance"
              description="One RPC, semester_hub(), builds this page for whoever is signed in."
              sqlId="hub.overview"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Courses this term"
                value={current.length}
                hint={`${myCurrentProjects.length} project team${myCurrentProjects.length === 1 ? '' : 's'}`}
                icon={BookOpen}
                tone="brand"
              />
              <StatCard
                label="Next deadline"
                value={nextDue ? countdownLabel(daysUntil(nextDue.next_deadline)) : '—'}
                hint={
                  nextDue
                    ? `${componentLabel(nextDue.next_milestone_no ?? 0)} ${nextDue.next_component} · ${nextDue.project_id}`
                    : 'Nothing due in your teams'
                }
                icon={CalendarClock}
                tone={nextDue && (daysUntil(nextDue.next_deadline) ?? 99) <= 3 ? 'pending' : 'default'}
              />
              <StatCard
                label="My claims"
                value={
                  totals.confirmed + totals.pending + totals.contested === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="flex items-baseline gap-3">
                      <span className={totals.confirmed ? 'text-confirmed' : 'text-muted-foreground'}>{totals.confirmed}</span>
                      <span className={totals.pending ? 'text-pending' : 'text-muted-foreground'}>{totals.pending}</span>
                      <span className={totals.contested ? 'text-contested' : 'text-muted-foreground'}>{totals.contested}</span>
                    </span>
                  )
                }
                hint={totals.confirmed + totals.pending + totals.contested === 0 ? 'No claims filed yet' : 'confirmed · pending · contested'}
                icon={PenLine}
                tone={totals.confirmed + totals.pending + totals.contested === 0 ? 'default' : 'confirmed'}
              />
              <StatCard
                label="Waiting for your countersign"
                value={hub.countersign_queue}
                hint={
                  hub.countersign_queue > 0 && firstTeamProject ? (
                    <Link to={`/projects/${firstTeamProject}?tab=queue`} className="text-brand hover:underline">
                      Open the queue →
                    </Link>
                  ) : (
                    'Teammates’ pending claims'
                  )
                }
                icon={Signature}
                tone={hub.countersign_queue > 0 ? 'pending' : 'default'}
              />
            </div>
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            {/* ---------- courses ---------- */}
            <section>
              <SectionHeader
                title="My courses this term"
                description="One card per course offering you are enrolled in, with the projects attached to it."
                sqlId="hub.courses"
              />
              {current.length === 0 ? (
                <EmptyState
                  icon={GraduationCap}
                  title="No courses this term"
                  description="You are not enrolled in a course offering for the current term yet. An admin adds enrollments."
                />
              ) : (
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  {current.map((g) => (
                    <CourseCard key={g.offering_id} group={g} isLive={isLive} evidence={evidence.data} />
                  ))}
                </div>
              )}

              {earlier.length ? (
                <div className="mt-8">
                  <h3 className="pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Earlier terms</h3>
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    {earlier.map((g) => (
                      <CourseCard key={g.offering_id} group={g} muted isLive={isLive} evidence={evidence.data} />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            {/* ---------- timeline ---------- */}
            <Panel
              title="Upcoming components"
              description={myLiveProjects.length && !showPractice ? 'Deadlines in your lab project.' : "Deadlines across your teams' projects."}
              sqlId="hub.timeline"
              className="lg:sticky lg:top-20"
              footer={
                myLiveProjects.length && practiceIds.length ? (
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => setShowPractice((v) => !v)}>
                    {showPractice ? 'Lab project only' : `Also show practice projects (${practiceIds.join(', ')})`}
                  </button>
                ) : undefined
              }
            >
              {timelineIds.length === 0 ? (
                <EmptyState compact icon={Users} title="No team yet" description="Join a team to see its component deadlines here." />
              ) : timeline.isError ? (
                <ErrorState compact error={timeline.error} onRetry={() => timeline.refetch()} />
              ) : timeline.isPending ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : timeline.data.length === 0 ? (
                <EmptyState compact icon={CalendarClock} title="Nothing upcoming" description="Every component deadline has passed." />
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {timeline.data.map((m) => {
                    const days = daysUntil(m.deadline)
                    return (
                      <li key={`${m.project_id}-${m.milestone_no}`} className="relative">
                        <span
                          className={cn(
                            'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card',
                            days !== null && days <= 3 ? 'bg-pending' : 'bg-brand',
                          )}
                          aria-hidden
                        />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              <span className="font-mono text-xs text-muted-foreground">{componentLabel(m.milestone_no)}</span>{' '}
                              {m.title}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              <Link to={`/projects/${m.project_id}`} className="hover:text-foreground hover:underline">
                                {m.project_id} · {titleOf(m.project_id)}
                              </Link>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(m.deadline)} · out of {m.max_marks}
                              {m.cie_part !== 'reduced' ? ` · ${m.cie_part}` : ''}
                            </p>
                          </div>
                          <CountdownChip deadline={m.deadline} locked={m.locked} />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}

function CourseCard({
  group,
  muted,
  isLive,
  evidence,
}: {
  group: OfferingGroup
  muted?: boolean
  isLive: (projectId: string | null | undefined) => boolean
  evidence: Set<string> | undefined
}) {
  const liveProjects = group.projects.filter((p) => isLive(p.project_id))
  const practice = group.projects.filter((p) => !isLive(p.project_id))
  // collapse the practice projects only when there is a live lab to show instead
  const collapsePractice = liveProjects.length > 0 && practice.length > 0
  const row = (p: HubCourse) => (
    <ProjectRow
      key={p.project_id}
      p={p}
      practice={!isLive(p.project_id)}
      closed={Boolean(muted) || p.project_status === 'completed'}
      hasEvidence={Boolean(p.project_id && evidence?.has(p.project_id))}
    />
  )
  return (
    <article className={cn('flex flex-col rounded-xl bg-card ring-1 ring-foreground/10', muted && 'opacity-80')}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {group.course_code} · Section {group.section} · {group.term_id}
          </p>
          <h3 className="text-sm font-semibold">{group.course_title}</h3>
          <p className="text-xs text-muted-foreground">{group.faculty_name}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <BookOpen className="size-4" aria-hidden />
        </span>
      </header>
      {group.projects.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No project is attached to this course yet.</p>
      ) : (
        <>
          <ul className="divide-y">{(collapsePractice ? liveProjects : group.projects).map(row)}</ul>
          {collapsePractice ? (
            <details className="group border-t">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                Practice projects ({practice.length})
              </summary>
              <ul className="divide-y border-t bg-muted/20">{practice.map(row)}</ul>
            </details>
          ) : null}
        </>
      )}
    </article>
  )
}

/**
 * One project in a course card. `practice` = a project with no course offering (not the term's
 * lab), labelled the same way here as in the timeline. `closed` = completed or from an earlier
 * term: no join call to action, since there is nothing left to work on.
 */
function ProjectRow({ p, practice, closed, hasEvidence }: { p: HubCourse; practice: boolean; closed: boolean; hasEvidence: boolean }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="font-mono text-xs text-muted-foreground">{p.project_id}</span> {p.project_title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {p.team_id ? (
              <Badge variant="secondary">
                <Users /> {p.team_name} · {p.team_role}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">{closed ? 'No team' : 'No team yet'}</span>
            )}
            <StatusBadge status={p.project_status === 'completed' ? 'locked' : 'open'} label={p.project_status ?? ''} />
            {practice ? (
              <Badge variant="outline" className="text-muted-foreground" title="A practice project: it is not attached to a course offering, so it is not this term's graded lab">
                practice
              </Badge>
            ) : null}
          </div>
        </div>
        {p.team_id ? (
          <Button asChild size="xs" variant="outline">
            <Link to={`/projects/${p.project_id}`}>
              Open <ArrowRight />
            </Link>
          </Button>
        ) : closed ? null : (
          <Button asChild size="xs" variant="ghost">
            <Link to={`/team?project=${p.project_id}`}>
              Find a team <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {p.next_deadline ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            Next: <span className="font-mono">{componentLabel(p.next_milestone_no ?? 0)}</span>
            <span className="text-foreground">{p.next_component}</span>
            <CountdownChip deadline={p.next_deadline} />
          </span>
        ) : (
          <span className="text-muted-foreground">No upcoming component</span>
        )}
        {p.team_id ? (
          <ClaimCounts
            pending={p.my_claims_pending ?? 0}
            confirmed={p.my_claims_confirmed ?? 0}
            contested={p.my_claims_contested ?? 0}
            hasEvidence={hasEvidence}
          />
        ) : null}
      </div>
    </li>
  )
}
