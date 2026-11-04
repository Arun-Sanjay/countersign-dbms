import { CircleCheck, Crown, GitBranch, LogOut, Puzzle, Search, Sparkles, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PanelSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { SqlButton } from '@/components/sql/SqlButton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useSemesterHub } from '@/data/hub'
import {
  useFindTeammates,
  useFullCover,
  useJoinTeam,
  useLeaveTeam,
  useProjectTeams,
  useSkillGap,
  useSkills,
  useSkillSubtree,
  type TeamWithMembers,
} from '@/data/team'
import type { FullCoverResult, SemesterHubStudent, SkillGapRow } from '@/data/types'
import { errorTag, toAppError, type AppError } from '@/lib/errors'
import { initials } from '@/lib/format'
import { toastError, toastSuccess } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { pickerProjects } from './parts/projects'
import { CapacityBar, Formula, LevelPips, ProjectPicker } from './parts/ui'

/** /team — join a team, teammate finder, skill gap, skill tree. */
export default function TeamPage() {
  const profile = useProfile()
  const [params, setParams] = useSearchParams()
  const hubQuery = useSemesterHub()
  const hub = hubQuery.data?.role === 'student' ? (hubQuery.data as SemesterHubStudent) : undefined
  const projects = useMemo(() => pickerProjects(hub?.courses ?? []), [hub])
  const projectId = params.get('project') ?? projects[0]?.project_id
  const project = projects.find((p) => p.project_id === projectId)

  const setProject = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('project', id)
        return next
      },
      { replace: true },
    )

  return (
    <>
      <PageHeader
        eyebrow="Team & skills"
        title={project?.team_id ? 'Your team and skills' : 'Find your team'}
        description={
          project?.team_id
            ? 'Your team in this project, teammates who would complement it (not clones of you), and the gap between what the project needs and what you have shown.'
            : 'Join a team, find teammates who complement your skills (not clones of you), and see the gap between what the project needs and what you have shown.'
        }
        actions={
          hubQuery.isPending ? (
            <Skeleton className="h-8 w-80" />
          ) : projects.length ? (
            <ProjectPicker projects={projects} value={projectId} onChange={setProject} />
          ) : null
        }
      />

      {hubQuery.isError ? (
        <ErrorState error={hubQuery.error} onRetry={() => hubQuery.refetch()} />
      ) : hubQuery.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : !projectId ? (
        <EmptyState
          icon={Users}
          title="No projects to join"
          description="You are not enrolled in a course offering with a project yet."
        />
      ) : (
        <div className="space-y-6">
          <TeamsPanel
            projectId={projectId}
            myUsn={profile.usn}
            projectTitle={project?.title}
            hasClaims={(hub?.courses ?? []).some(
              (c) => c.project_id === projectId && (c.my_claims_pending ?? 0) + (c.my_claims_confirmed ?? 0) + (c.my_claims_contested ?? 0) > 0,
            )}
          />
          <div className="grid items-start gap-6 lg:grid-cols-5">
            <FinderPanel projectId={projectId} className="lg:col-span-3" />
            <SkillGapPanel projectId={projectId} className="lg:col-span-2" />
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-5">
            <FullCoverPanel projectId={projectId} myUsn={profile.usn} className="lg:col-span-2" />
            <SkillTreePanel projectId={projectId} className="lg:col-span-3" />
          </div>
        </div>
      )}
    </>
  )
}

// ======================================================================================
// Teams + join / leave
// ======================================================================================
function TeamsPanel({
  projectId,
  myUsn,
  projectTitle,
  hasClaims,
}: {
  projectId: string
  myUsn: string | null
  projectTitle?: string
  /** I have claims in this project: leave_team() would refuse (leave_team_has_history) */
  hasClaims: boolean
}) {
  const teams = useProjectTeams(projectId)
  const join = useJoinTeam()
  const leave = useLeaveTeam()
  const [errors, setErrors] = useState<Partial<Record<string, AppError>>>({})
  const myTeam = teams.data?.find((t) => t.members.some((m) => m.usn === myUsn))

  const onJoin = (team: TeamWithMembers) => {
    setErrors((e) => ({ ...e, [team.team_id]: undefined }))
    join.mutate(team.team_id, {
      onSuccess: (r) => toastSuccess(`Joined ${team.team_name}`, `You are its ${r.role}: ${r.members} of ${r.max_size} places taken.`),
      // live error mapping: the trigger's SQLSTATE + DETAIL rule key, shown on the card
      onError: (err) => setErrors((e) => ({ ...e, [team.team_id]: toAppError(err) })),
    })
  }

  const onLeave = async (team: TeamWithMembers) => {
    try {
      await leave.mutateAsync(team.team_id)
      toastSuccess(`Left ${team.team_name}`)
    } catch (err) {
      setErrors((e) => ({ ...e, [team.team_id]: toAppError(err) }))
      toastError(err)
      throw err
    }
  }

  return (
    <Panel
      title={`Teams in ${projectId}${projectTitle ? ` · ${projectTitle}` : ''}`}
      description={
        myTeam
          ? `You are in ${myTeam.team_name}. One team per project: the database refuses a second one.`
          : 'Pick a team with space. Capacity, one-team-per-project and enrollment are checked by triggers, race-safely.'
      }
      actions={
        <span className="flex items-center gap-1.5">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">teams</span>
          <SqlButton panelId="team.members" />
          <span className="hidden pl-1 font-mono text-[11px] text-muted-foreground sm:inline">join_team()</span>
          <SqlButton panelId="team.join" />
        </span>
      }
    >
      {teams.isError ? (
        <ErrorState compact error={teams.error} onRetry={() => teams.refetch()} />
      ) : teams.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : teams.data.length === 0 ? (
        <EmptyState compact icon={Users} title="No teams yet" description="Your faculty or an admin creates the teams for this project." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.data.map((t) => {
            const mine = t.team_id === myTeam?.team_id
            const full = t.members.length >= t.max_size
            const err = errors[t.team_id]
            const busy = join.isPending && join.variables === t.team_id
            return (
              <article
                key={t.team_id}
                data-team={t.team_id}
                className={cn(
                  'flex flex-col gap-3 rounded-xl p-4 ring-1',
                  mine ? 'bg-brand-soft/40 ring-brand/30' : 'ring-foreground/10',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{t.team_id}</p>
                    <h3 className="text-sm font-semibold">{t.team_name}</h3>
                    {t.topic_title ? <p className="line-clamp-2 text-xs text-muted-foreground">{t.topic_title}</p> : null}
                  </div>
                  {mine ? <Badge>Your team</Badge> : full ? <Badge variant="outline">Full</Badge> : null}
                </div>
                <CapacityBar members={t.members.length} max={t.max_size} />
                <ul className="space-y-1">
                  {t.members.map((m) => (
                    <li key={m.usn} className="flex items-center gap-2 text-sm">
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
                      </Avatar>
                      <span className={cn('truncate', m.usn === myUsn && 'font-medium')}>
                        {m.name}
                        {m.usn === myUsn ? ' (you)' : ''}
                      </span>
                      {m.role === 'lead' ? <Crown className="size-3.5 shrink-0 text-pending" aria-label="Team lead" /> : null}
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{m.usn}</span>
                    </li>
                  ))}
                  {t.members.length === 0 ? <li className="text-xs text-muted-foreground">No members yet: the first to join leads.</li> : null}
                </ul>
                {err ? (
                  <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-xs">
                    <p className="font-medium text-destructive">{err.title}</p>
                    <p className="text-muted-foreground">{err.message}</p>
                    {errorTag(err) ? <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{errorTag(err)}</p> : null}
                  </div>
                ) : null}
                <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                  {mine && hasClaims ? (
                    <p className="mr-auto text-xs text-muted-foreground">
                      You have claims in this team, so it keeps you: recorded work stays with the team it was made in.
                    </p>
                  ) : null}
                  {mine && hasClaims ? (
                    <Button size="sm" variant="ghost" disabled title="leave_team() refuses once you have recorded work in the team">
                      <LogOut /> Leave
                    </Button>
                  ) : mine ? (
                    <ConfirmDialog
                      title={`Leave ${t.team_name}?`}
                      description="If you have recorded work in this team (claims, countersigns, contributions or marks), the database will refuse: that history stays with the team it was made in."
                      confirmLabel="Leave team"
                      tone="destructive"
                      onConfirm={() => onLeave(t)}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <LogOut /> Leave
                        </Button>
                      }
                    >
                      <div className="flex justify-end">
                        <SqlButton panelId="team.leave" />
                      </div>
                    </ConfirmDialog>
                  ) : myTeam ? (
                    <Button size="sm" variant="outline" disabled title="One team per project: you are already in a team here">
                      <UserPlus /> Join
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={full ? 'outline' : 'default'}
                      onClick={() => onJoin(t)}
                      disabled={busy}
                      title={full ? 'Full: the capacity trigger will refuse. Try it to see the rule.' : undefined}
                    >
                      <UserPlus /> {busy ? 'Joining…' : full ? 'Join anyway' : 'Join'}
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// ======================================================================================
// Complementary teammate finder
// ======================================================================================
function FinderPanel({ projectId, className }: { projectId: string; className?: string }) {
  const q = useFindTeammates(projectId)
  return (
    <Panel
      title="Teammate finder"
      description="Complements, not clones: students outside any team of this project who hold the skills you are missing."
      sqlId="team.finder"
      className={className}
    >
      <Formula className="mb-4">
        Missing(me, P) = Required(P) − Mine
        <br />
        Candidates = γ<sub>usn; count(*)→covered</sub>(StudentSkill ⋈ Missing), ranked by covered
        <br />
        <span className="text-muted-foreground">covers all ⇔ StudentSkill ÷ (Required(P) − Mine)</span>
      </Formula>
      {q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="pb-1.5 text-xs font-medium text-muted-foreground">You are missing ({q.data.missing.length})</p>
            {q.data.missing.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-confirmed">
                <CircleCheck className="size-4" /> You already cover every required skill at the required level.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {q.data.missing.map((m) => (
                  <Badge key={m.skill_id} variant="outline">
                    {m.name} <span className="text-muted-foreground">≥ L{m.required_level}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {q.data.missing.length === 0 ? null : q.data.candidates.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              title="No complementary candidates"
              description="Nobody outside a team of this project, and enrolled in its offering, holds those skills at the required level."
            />
          ) : (
            <ul className="space-y-2">
              {q.data.candidates.map((c) => (
                <li key={c.usn} className="flex flex-wrap items-center gap-3 rounded-lg p-3 ring-1 ring-foreground/10">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">{initials(c.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {c.name} <span className="font-mono text-xs font-normal text-muted-foreground">{c.usn} · Sec {c.section}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.skills.map((s) => (
                        <span
                          key={s.skill_id}
                          className="inline-flex h-5 items-center gap-1 rounded-full bg-confirmed-soft px-2 text-xs text-confirmed ring-1 ring-confirmed/25 ring-inset"
                        >
                          {s.name} L{s.level}
                          <span className="opacity-70">≥ {s.required_level}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm font-semibold">
                      {c.covered}/{q.data.missing.length}
                    </p>
                    {c.covers_all ? (
                      <span className="inline-flex items-center gap-1 text-xs text-confirmed">
                        <Sparkles className="size-3" /> full complement
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">covered</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}

// ======================================================================================
// Skill gap: declared vs verified
// ======================================================================================
const GAP_STATUS: Record<SkillGapRow['status'], { label: string; status: string }> = {
  met: { label: 'Met', status: 'confirmed' },
  below: { label: 'Below', status: 'pending' },
  missing: { label: 'Missing', status: 'contested' },
}

function SkillGapPanel({ projectId, className }: { projectId: string; className?: string }) {
  const q = useSkillGap(projectId)
  return (
    <Panel
      title="Skill gap"
      description="Declared = what you said. Verified = the best level backed by evidence from confirmed claims."
      sqlId="team.skill_gap"
      className={className}
    >
      {q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : q.data.total === 0 ? (
        <EmptyState compact icon={Puzzle} title="No required skills" description="This project lists no required skills." />
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="tabular text-lg font-semibold">
              {q.data.met}/{q.data.total}
            </span>{' '}
            <span className="text-muted-foreground">required skills met (declared)</span>
          </p>
          <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
            {q.data.skills.map((s) => (
              <li key={s.skill_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {s.name} <span className="font-mono text-xs font-normal text-muted-foreground">≥ L{s.required_level}</span>
                  </p>
                </div>
                <StatusBadge status={GAP_STATUS[s.status].status} label={GAP_STATUS[s.status].label} plain />
                <div className="col-span-2 grid grid-cols-[4.5rem_auto_1fr] items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>Declared</span>
                  <LevelPips value={s.declared_level} required={s.required_level} label="Declared" />
                  <span className="tabular">{s.declared_level ?? '—'}</span>
                  <span>Verified</span>
                  <LevelPips value={s.verified_level} required={s.required_level} tone="confirmed" label="Verified" />
                  <span className="tabular">
                    {s.verified_level ?? <span className="italic">no recorded evidence yet</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            The outlined pip marks the required level. Verified levels grow as teammates confirm your claims.
          </p>
        </div>
      )}
    </Panel>
  )
}

// ======================================================================================
// Full cover: textbook division
// ======================================================================================
function fullCoverColumns(myUsn: string | null): Column<FullCoverResult[number]>[] {
  return [
    {
      key: 'name',
      header: 'Student',
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className={cn(r.usn === myUsn && 'font-medium')}>
          {r.name}
          {r.usn === myUsn ? ' (you)' : ''}
          <span className="block font-mono text-[11px] text-muted-foreground">
            {r.usn} · Sec {r.section}
          </span>
        </span>
      ),
    },
    {
      key: 'team_id',
      header: 'Team in this project',
      sortValue: (r) => r.team_id ?? '~',
      cell: (r) => (r.team_id ? <span className="font-mono text-xs">{r.team_id}</span> : <span className="text-xs text-muted-foreground">none yet</span>),
    },
  ]
}

function FullCoverPanel({ projectId, myUsn, className }: { projectId: string; myUsn: string | null; className?: string }) {
  const q = useFullCover(projectId)
  const columns = fullCoverColumns(myUsn)
  return (
    <Panel
      title="Full cover (relational division)"
      description="Students who hold every required skill at the required level."
      sqlId="team.full_cover"
      className={className}
    >
      <Formula className="mb-3">
        StudentSkill ÷ Required(P) ≡ ¬∃ required skill s : ¬∃ (usn, s, level ≥ min)
      </Formula>
      {q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data}
          loading={q.isPending}
          rowKey={(r) => r.usn}
          dense
          initialSort={{ key: 'team_id', dir: 'asc' }}
          empty={
            <EmptyState
              compact
              icon={Users}
              title="Nobody covers everything"
              description="That is why the finder ranks partial covers: a team covers the project, rarely one person."
            />
          }
        />
      )}
    </Panel>
  )
}

// ======================================================================================
// Recursive skill tree
// ======================================================================================
function SkillTreePanel({ projectId, className }: { projectId: string; className?: string }) {
  const skills = useSkills()
  const gap = useSkillGap(projectId)
  const roots = (skills.data ?? []).filter((s) => s.parent_skill_id === null)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const root = picked ?? roots[0]?.skill_id
  const tree = useSkillSubtree(root)
  const required = new Map((gap.data?.skills ?? []).map((s) => [s.skill_id, s]))

  return (
    <Panel
      title="Skill tree"
      description="A skill and every descendant, through the recursive relationship skill → parent_skill (WITH RECURSIVE)."
      sqlId="team.skill_tree"
      className={className}
      actions={
        <Select value={root ?? ''} onValueChange={setPicked} disabled={!roots.length}>
          <SelectTrigger size="sm" className="w-40" aria-label="Root skill">
            <SelectValue placeholder="Root skill" />
          </SelectTrigger>
          <SelectContent>
            {roots.map((r) => (
              <SelectItem key={r.skill_id} value={r.skill_id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {skills.isError ? (
        <ErrorState compact error={skills.error} onRetry={() => skills.refetch()} />
      ) : tree.isError ? (
        <ErrorState compact error={tree.error} onRetry={() => tree.refetch()} />
      ) : skills.isPending || tree.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7" style={{ width: `${90 - i * 10}%`, marginLeft: `${i * 4}%` }} />
          ))}
        </div>
      ) : tree.data.length === 0 ? (
        <EmptyState compact icon={GitBranch} title="Empty tree" description="This skill has no descendants." />
      ) : (
        <div className="space-y-3">
          <ul className="font-mono text-sm" aria-label="Skill tree">
            {tree.data.map((n, i) => {
              const isLastSibling = !tree.data.slice(i + 1).some((m) => m.depth === n.depth && m.parent_skill_id === n.parent_skill_id)
              const req = required.get(n.skill_id)
              return (
                <li key={n.skill_id} className="flex items-center gap-2 py-1" style={{ paddingLeft: `${n.depth * 1.5}rem` }}>
                  <span className="text-muted-foreground/60" aria-hidden>
                    {n.depth === 0 ? '●' : isLastSibling ? '└─' : '├─'}
                  </span>
                  <span className={cn('font-sans', n.depth === 0 && 'font-semibold')}>{n.name}</span>
                  <span className="text-[11px] text-muted-foreground">{n.skill_id}</span>
                  <Badge variant="secondary" className="font-sans">
                    {n.category}
                  </Badge>
                  {req ? (
                    <StatusBadge
                      status={GAP_STATUS[req.status].status}
                      label={`${projectId} needs L${req.required_level}`}
                      plain
                      className="font-sans"
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            depth = recursion level; order = <span className="font-mono">SEARCH DEPTH FIRST BY skill_id</span>; a{' '}
            <span className="font-mono">CYCLE</span> clause stops bad data from looping.{' '}
            <Link to="/about" className="text-brand hover:underline">
              Units I–V map
            </Link>
          </p>
        </div>
      )}
    </Panel>
  )
}
