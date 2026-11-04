import { ClipboardList, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AiBadge } from '@/components/AiBadge'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProfile } from '@/auth/AuthProvider'
import { useContestedClaims, useMilestones, type ContestedRow } from '@/data/faculty'
import { componentLabel, formatDateTime, formatRelative } from '@/lib/format'
import { ClaimDrawer, type CellRef } from './components/ClaimDrawer'

const ALL = '__all__'

const COLUMNS: Column<ContestedRow>[] = [
  {
    key: 'claim',
    header: 'Claim',
    cell: (r) => (
      <div className="max-w-md space-y-0.5">
        <p className="line-clamp-2 text-sm text-pretty">“{r.statement}”</p>
        <p className="font-mono text-xs text-muted-foreground">
          #{r.claim_id} · filed {formatDateTime(r.created_at)}
        </p>
      </div>
    ),
    sortValue: (r) => r.claim_id,
  },
  {
    key: 'claimant',
    header: 'Claimant',
    cell: (r) => (
      <div>
        <div className="font-medium">{r.claimant}</div>
        <div className="font-mono text-xs text-muted-foreground">{r.usn}</div>
      </div>
    ),
    sortValue: (r) => r.claimant,
  },
  {
    key: 'team',
    header: 'Team',
    cell: (r) => (
      <div>
        <div>{r.team_name}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {r.team_id} · {r.project_id}
        </div>
      </div>
    ),
    sortValue: (r) => r.team_id,
  },
  {
    key: 'component',
    header: 'Component',
    cell: (r) => (
      <span>
        <span className="font-semibold">{componentLabel(r.milestone_no)}</span>{' '}
        <span className="text-muted-foreground">{r.component}</span>
      </span>
    ),
    sortValue: (r) => r.milestone_no,
  },
  {
    key: 'ai',
    header: 'AI declared',
    cell: (r) => <AiBadge value={r.ai_assistance} />,
  },
  {
    key: 'verdicts',
    header: 'Countersigns',
    cell: (r) => (
      <span className="flex flex-wrap gap-1">
        <StatusBadge status="contested" label={`${r.disputes ?? 0} dispute${r.disputes === 1 ? '' : 's'}`} />
        {Number(r.confirms ?? 0) > 0 ? <StatusBadge status="confirmed" label={`${r.confirms} confirm${r.confirms === 1 ? '' : 's'}`} /> : null}
      </span>
    ),
    sortValue: (r) => r.disputes,
  },
  {
    key: 'last',
    header: 'Last disputed',
    cell: (r) => <span title={formatDateTime(r.last_disputed_at)}>{formatRelative(r.last_disputed_at)}</span>,
    sortValue: (r) => r.last_disputed_at ?? '',
  },
]

/** /contested — claims a teammate disputed: the faculty review queue. */
export default function ContestedPage() {
  const profile = useProfile()
  const q = useContestedClaims()
  const [project, setProject] = useState(ALL)
  const [team, setTeam] = useState(ALL)
  const [text, setText] = useState('')
  const [open, setOpen] = useState<ContestedRow | null>(null)
  const milestones = useMilestones(open?.project_id ?? '')

  const rows = q.data
  const projects = useMemo(() => [...new Set((rows ?? []).map((r) => r.project_id))].sort(), [rows])
  const teams = useMemo(
    () =>
      [...new Map((rows ?? []).filter((r) => project === ALL || r.project_id === project).map((r) => [r.team_id, r.team_name])).entries()].sort(
        (a, b) => a[0].localeCompare(b[0]),
      ),
    [rows, project],
  )
  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return rows?.filter(
      (r) =>
        (project === ALL || r.project_id === project) &&
        (team === ALL || r.team_id === team) &&
        (!needle ||
          r.statement.toLowerCase().includes(needle) ||
          r.claimant.toLowerCase().includes(needle) ||
          r.usn.toLowerCase().includes(needle)),
    )
  }, [rows, project, team, text])

  const milestone = milestones.data?.find((m) => m.milestone_no === open?.milestone_no)
  const cell: CellRef | null =
    open && milestone
      ? {
          usn: open.usn,
          name: open.claimant,
          teamId: open.team_id,
          teamName: open.team_name,
          projectId: open.project_id,
          milestone,
        }
      : null
  const filtersActive = project !== ALL || team !== ALL || text.trim() !== ''

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Contested claims"
        description="Claims a teammate disputed, with the comment that says why. A dispute is a conversation starter, not a verdict: open one to see the evidence and both sides."
        meta={
          rows ? (
            <StatusBadge status="contested" label={`${rows.length} contested claim${rows.length === 1 ? '' : 's'}`} />
          ) : null
        }
      />

      <Panel
        title="Review queue"
        description="Newest dispute first. Only projects you oversee appear: the view is security_invoker, so claim_select filters it."
        sqlId="faculty.contested"
      >
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <FilterBar
            projects={projects}
            teams={teams}
            project={project}
            team={team}
            text={text}
            setProject={(v) => {
              setProject(v)
              setTeam(ALL)
            }}
            setTeam={setTeam}
            setText={setText}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={filtered}
            loading={q.isPending}
            rowKey={(r) => String(r.claim_id)}
            onRowClick={setOpen}
            isRowActive={(r) => r.claim_id === open?.claim_id}
            initialSort={{ key: 'last', dir: 'desc' }}
            empty={
              rows && rows.length > 0 && filtersActive ? (
                <EmptyState
                  compact
                  icon={Search}
                  title="No contested claim matches these filters"
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setProject(ALL)
                        setTeam(ALL)
                        setText('')
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={TriangleAlert}
                  title="Nothing contested"
                  description={
                    profile.role === 'faculty'
                      ? 'No teammate has disputed a claim in the projects you teach. Rows of other projects are invisible to you under row-level security.'
                      : 'No claim is contested anywhere.'
                  }
                />
              )
            }
          />
        )}
      </Panel>

      <ClaimDrawer
        cell={cell}
        onOpenChange={(o) => !o && setOpen(null)}
        canRecord={profile.role === 'faculty'}
        highlightClaimId={open?.claim_id}
        actions={
          open ? (
            <Button asChild size="xs" variant="outline">
              <Link to={`/sheet/${open.project_id}`}>
                <ClipboardList /> Open the {open.project_id} rubric sheet
              </Link>
            </Button>
          ) : null
        }
      />
    </>
  )
}

function FilterBar({
  projects,
  teams,
  project,
  team,
  text,
  setProject,
  setTeam,
  setText,
}: {
  projects: string[]
  teams: [string, string][]
  project: string
  team: string
  text: string
  setProject: (v: string) => void
  setTeam: (v: string) => void
  setText: (v: string) => void
}) {
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search claim or student"
          aria-label="Search claims"
          className="h-7 w-48 pl-7 text-sm"
        />
      </div>
      <Select value={project} onValueChange={setProject}>
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by project">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={team} onValueChange={setTeam}>
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by team">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All teams</SelectItem>
          {teams.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name} ({id})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
