import { FileText, FolderKanban, Inbox, PenLine, ReceiptText, Send, Signature, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PageSkeleton, PanelSkeleton } from '@/components/Skeletons'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useArtifacts,
  useComponents,
  useMyTeam,
  useProjectInfo,
  useSubmissions,
  useTeamClaims,
  useTeamContributions,
  type ArtifactRow,
  type ComponentRow,
  type ContributionRow,
  type SubmissionRow,
} from '@/data/projects'
import { componentLabel, formatDate, formatDateTime, formatMarks, todayIso } from '@/lib/format'
import { CONTRIBUTION_LABEL } from './parts/labels'
import { AiBadge, ClaimCounts, CountdownChip, type EvidenceLookups } from './parts/ui'
import { MyClaimCard, QueueCard, SignedRow } from './project/claims'
import { FileClaimDialog } from './project/FileClaimDialog'
import { SubmitDialog } from './project/SubmitDialog'

const TABS = ['components', 'claims', 'queue', 'artifacts'] as const
type Tab = (typeof TABS)[number]

/**
 * /projects/:projectId — milestones, artifacts, my claims, file a claim, add evidence,
 * countersign queue, submit a component.
 */
export default function ProjectPage() {
  const { projectId = '' } = useParams()
  const profile = useProfile()
  const usn = profile.usn
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'components'
  const setTab = (t: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', t)
        return next
      },
      { replace: true },
    )

  const info = useProjectInfo(projectId)
  const team = useMyTeam(projectId, usn)
  const teamId = team.data?.team_id
  const components = useComponents(projectId, usn)
  const submissions = useSubmissions(projectId, teamId)
  const artifacts = useArtifacts(projectId, teamId)
  const claims = useTeamClaims(projectId, teamId)
  const contributions = useTeamContributions(projectId, teamId)

  const [claimDialog, setClaimDialog] = useState<{ open: boolean; milestone?: number }>({ open: false })
  const [submitFor, setSubmitFor] = useState<{ no: number; nonce: number } | null>(null)

  if (info.isPending || team.isPending) return <PageSkeleton />
  if (info.isError) return <ErrorState error={info.error} onRetry={() => info.refetch()} />
  if (team.isError) return <ErrorState error={team.error} onRetry={() => team.refetch()} />
  if (!info.data) {
    return (
      <EmptyState
        icon={FolderKanban}
        title={`No project ${projectId}`}
        description="That project does not exist, or it is not visible to you."
        action={
          <Button asChild variant="outline">
            <Link to="/hub">Back to the hub</Link>
          </Button>
        }
      />
    )
  }
  const project = info.data

  if (!team.data || !teamId) {
    return (
      <>
        <PageHeader eyebrow={`${project.project_id} · ${project.course_code}`} title={project.title} description={project.description ?? undefined} />
        <EmptyState
          icon={Users}
          title="You are not in a team for this project"
          description="Claims, evidence and submissions belong to a team. Join one first: one team per project."
          action={
            <Button asChild>
              <Link to={`/team?project=${project.project_id}`}>Find a team</Link>
            </Button>
          }
        />
      </>
    )
  }
  const myTeam = team.data

  const componentRows = components.data ?? []
  const componentTitle = (no: number) => componentRows.find((c) => c.milestone_no === no)?.component
  const isLocked = (no: number) => componentRows.find((c) => c.milestone_no === no)?.locked ?? false
  const allClaims = claims.data ?? []
  const myClaims = allClaims.filter((c) => c.usn === usn)
  const teammateClaims = allClaims.filter((c) => c.usn !== usn)
  const queue = teammateClaims.filter((c) => c.status === 'pending' && !c.countersigns.some((s) => s.endorser_usn === usn))
  const signed = teammateClaims.filter((c) => c.countersigns.some((s) => s.endorser_usn === usn))
  const others = teammateClaims.filter((c) => !queue.includes(c) && !signed.includes(c))

  const artifactRows = artifacts.data ?? []
  const contributionRows = contributions.data ?? []
  const evidenceOptions = {
    contributions: contributionRows.filter((k) => k.usn === usn),
    artifacts: artifactRows,
  }
  const lookups: EvidenceLookups = {
    artifactTitle: (id) => artifactRows.find((a) => a.artifact_id === id)?.title,
    contribution: (id) => {
      const k = contributionRows.find((x) => x.contribution_id === id)
      return k ? `${k.contribution_type} on ${k.artifact_title}${k.description ? `: ${k.description}` : ''}` : undefined
    },
  }
  const nameOf = (u: string) => myTeam.members.find((m) => m.usn === u)?.name
  const titleOf = (id: string) => artifactRows.find((a) => a.artifact_id === id)?.title
  // marks with no claim behind them: the one call to action this tab needs
  const unclaimedMarks = componentRows.filter((c) => c.marks !== null && c.claims_pending + c.claims_confirmed + c.claims_contested === 0)
  const latestSubmission = (no: number) =>
    (submissions.data ?? []).filter((s) => s.milestone_no === no).sort((a, b) => b.attempt_no - a.attempt_no)[0]

  const openClaim = (milestone?: number) => setClaimDialog({ open: true, milestone })
  const openSubmit = (no: number) => setSubmitFor({ no, nonce: Date.now() })

  return (
    <>
      <PageHeader
        eyebrow={`${project.project_id} · ${project.title} · ${project.course_code}`}
        title="Components, claims and receipts"
        description="Every mark has a receipt: claim what you did for each component, back it with evidence, and countersign your teammates' claims."
        meta={
          <>
            <Badge variant="secondary">
              <Users /> {myTeam.team_name} · {myTeam.role}
            </Badge>
            {myTeam.members.map((m) => (
              <Badge key={m.usn} variant="outline">
                {m.name}
                {m.usn === usn ? ' (you)' : ''}
              </Badge>
            ))}
            {myTeam.topic_title ? <span className="text-xs text-muted-foreground">“{myTeam.topic_title}”</span> : null}
          </>
        }
        actions={
          <Button onClick={() => openClaim()} disabled={components.isPending}>
            <PenLine /> File a claim
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="components">
            <FolderKanban /> Components
          </TabsTrigger>
          <TabsTrigger value="claims">
            <PenLine /> My claims
            <span className="tabular text-xs text-muted-foreground">{myClaims.length}</span>
          </TabsTrigger>
          <TabsTrigger value="queue">
            <Signature /> Countersign queue
            {queue.length ? (
              <span className="tabular rounded-full bg-pending-soft px-1.5 text-xs text-pending">{queue.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="artifacts">
            <FileText /> Artifacts
            <span className="tabular text-xs text-muted-foreground">{artifactRows.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ---------------- components ---------------- */}
        <TabsContent value="components" className="space-y-6">
          <Panel
            title="Components"
            description="One row per lab component: its deadline, lock state, your own marks once assessed, and your claims."
            sqlId="project.milestones"
            flush
          >
            {unclaimedMarks.length > 0 ? (
              <div className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-pending-soft/60 px-4 py-3 ring-1 ring-pending/25">
                <ReceiptText className="size-5 shrink-0 text-pending" aria-hidden />
                <p className="min-w-0 flex-1 text-sm">
                  You have marks on{' '}
                  <span className="font-medium">{new Intl.ListFormat('en', { type: 'conjunction' }).format(unclaimedMarks.map((c) => componentLabel(c.milestone_no)))}</span> with no claim behind
                  them. Every mark should have a receipt: file a claim for what you did.
                </p>
                <Button size="sm" onClick={() => openClaim(unclaimedMarks.find((c) => !c.locked)?.milestone_no)}>
                  <PenLine /> File a claim
                </Button>
              </div>
            ) : null}
            {components.isError ? (
              <div className="px-5 pb-5">
                <ErrorState compact error={components.error} onRetry={() => components.refetch()} />
              </div>
            ) : (
              <div className="px-5 pb-5">
                <DataTable
                  columns={componentColumns({ latestSubmission, onClaim: openClaim, onSubmit: openSubmit })}
                  rows={components.data}
                  loading={components.isPending}
                  rowKey={(r) => String(r.milestone_no)}
                  skeletonRows={6}
                  empty={<EmptyState compact icon={FolderKanban} title="No components" description="This project has no milestones yet." />}
                />
              </div>
            )}
          </Panel>
          <Panel
            title="Submissions"
            description="Each attempt freezes specific artifact versions. Resubmitting is allowed until the component is locked."
            sqlId="project.submissions"
          >
            {submissions.isError ? (
              <ErrorState compact error={submissions.error} onRetry={() => submissions.refetch()} />
            ) : (
              <DataTable
                columns={submissionColumns(nameOf, titleOf)}
                rows={submissions.data?.map((s) => ({ ...s, title: componentTitle(s.milestone_no) ?? '' }))}
                loading={submissions.isPending}
                rowKey={(r) => String(r.submission_id)}
                dense
                empty={<EmptyState compact icon={Send} title="Nothing submitted yet" description="Use Submit on a component row." />}
              />
            )}
          </Panel>
        </TabsContent>

        {/* ---------------- my claims ---------------- */}
        <TabsContent value="claims">
          <Panel
            title="My claims"
            description="Your claims in this project, each with its evidence and your teammates' countersigns."
            sqlId="project.claims"
            actions={
              <Button size="sm" variant="outline" onClick={() => openClaim()}>
                <PenLine /> File a claim
              </Button>
            }
          >
            {claims.isError ? (
              <ErrorState compact error={claims.error} onRetry={() => claims.refetch()} />
            ) : claims.isPending ? (
              <div className="space-y-3">
                <PanelSkeleton lines={2} />
                <PanelSkeleton lines={2} />
              </div>
            ) : myClaims.length === 0 ? (
              <EmptyState
                compact
                icon={PenLine}
                title="No claims filed yet"
                description="File a claim for a component you worked on, and attach the evidence behind it: every mark should have a receipt."
                action={
                  <Button size="sm" onClick={() => openClaim()}>
                    <PenLine /> File your first claim
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {myClaims.map((c) => (
                  <MyClaimCard
                    key={c.claim_id}
                    claim={c}
                    projectId={projectId}
                    componentTitle={componentTitle(c.milestone_no)}
                    locked={isLocked(c.milestone_no)}
                    options={evidenceOptions}
                    lookups={lookups}
                  />
                ))}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* ---------------- countersign queue ---------------- */}
        <TabsContent value="queue" className="space-y-6">
          <Panel
            title="Countersign queue"
            description="Your teammates' pending claims that you have not signed yet. Confirm what you saw them do; dispute with a reason."
            sqlId="project.countersign_queue"
          >
            {claims.isError ? (
              <ErrorState compact error={claims.error} onRetry={() => claims.refetch()} />
            ) : claims.isPending ? (
              <PanelSkeleton lines={3} />
            ) : queue.length === 0 ? (
              <EmptyState compact icon={Inbox} title="Nothing to sign" description="No teammate has a pending claim waiting for you." />
            ) : (
              <div className="space-y-3">
                {queue.map((c) => (
                  <QueueCard key={c.claim_id} claim={c} projectId={projectId} componentTitle={componentTitle(c.milestone_no)} lookups={lookups} />
                ))}
              </div>
            )}
          </Panel>
          {signed.length + others.length > 0 ? (
            <Panel title="Teammates' other claims" description="Claims you already signed, or that others have settled." sqlId="project.countersign_queue">
              <ul className="divide-y">
                {[...signed, ...others].map((c) => (
                  <SignedRow key={c.claim_id} claim={c} myUsn={usn ?? ''} componentTitle={componentTitle(c.milestone_no)} />
                ))}
              </ul>
            </Panel>
          ) : null}
        </TabsContent>

        {/* ---------------- artifacts ---------------- */}
        <TabsContent value="artifacts" className="space-y-6">
          <Panel
            title="Artifacts"
            description="Three privacy tiers: private (only the owner), team (your team; faculty see counts only), submitted (also your teaching faculty)."
            sqlId="project.artifacts"
          >
            {artifacts.isError ? (
              <ErrorState compact error={artifacts.error} onRetry={() => artifacts.refetch()} />
            ) : (
              <DataTable
                columns={artifactColumns(usn, nameOf)}
                rows={artifacts.data}
                loading={artifacts.isPending}
                rowKey={(r) => r.artifact_id}
                initialSort={{ key: 'component', dir: 'asc' }}
                empty={<EmptyState compact icon={FileText} title="No artifacts yet" description="Your team has not recorded any artifact." />}
              />
            )}
          </Panel>
          <Panel title="Who built what" description="Every contribution row of your team, newest first." sqlId="project.who_built_what">
            {contributions.isError ? (
              <ErrorState compact error={contributions.error} onRetry={() => contributions.refetch()} />
            ) : (
              <DataTable
                columns={CONTRIBUTION_COLUMNS}
                rows={contributions.data}
                loading={contributions.isPending}
                rowKey={(r) => String(r.contribution_id)}
                dense
                empty={<EmptyState compact icon={Users} title="No recorded evidence yet" description="No contribution has been recorded for this team." />}
              />
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <FileClaimDialog
        projectId={projectId}
        open={claimDialog.open}
        onOpenChange={(open) => setClaimDialog((s) => ({ ...s, open }))}
        components={componentRows}
        initialMilestone={claimDialog.milestone}
        options={evidenceOptions}
      />
      {submitFor ? (
        <SubmitDialog
          key={`${submitFor.no}-${submitFor.nonce}`}
          projectId={projectId}
          teamId={teamId}
          component={componentRows.find((c) => c.milestone_no === submitFor.no)}
          open
          onOpenChange={(open) => !open && setSubmitFor(null)}
          artifacts={artifactRows}
          submissions={submissions.data ?? []}
        />
      ) : null}
    </>
  )
}

// ---- table columns (module scope: no components defined during render) ------------------------
function componentColumns(opts: {
  latestSubmission: (no: number) => SubmissionRow | undefined
  onClaim: (no: number) => void
  onSubmit: (no: number) => void
}): Column<ComponentRow>[] {
  return [
    {
      key: 'component',
      header: 'Component',
      sortValue: (r) => r.milestone_no,
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-xs text-muted-foreground">{componentLabel(r.milestone_no)}</span>{' '}
          <span className="font-medium">{r.component}</span>
          {!r.counts_in_reduced ? <span className="block text-[11px] text-muted-foreground">added as-is to the /50 total</span> : null}
        </div>
      ),
    },
    { key: 'max_marks', header: 'Out of', align: 'right', sortValue: (r) => r.max_marks, cell: (r) => <span className="tabular">{r.max_marks}</span> },
    {
      key: 'deadline',
      header: 'Deadline',
      sortValue: (r) => r.deadline,
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-xs">{formatDate(r.deadline)}</span>
          {r.locked ? null : <CountdownChip deadline={r.deadline} />}
        </div>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (r) => {
        const sub = opts.latestSubmission(r.milestone_no)
        const overdue = !r.locked && !sub && r.deadline !== '' && r.deadline < todayIso()
        return (
          <div className="flex flex-wrap gap-1">
            {r.locked ? <StatusBadge status="locked" /> : overdue ? null : <StatusBadge status="open" />}
            {sub ? <StatusBadge status="submitted" label={`Submitted · #${sub.attempt_no}`} /> : null}
            {overdue ? <StatusBadge status="pending" label="Past deadline · not submitted" /> : null}
          </div>
        )
      },
    },
    {
      key: 'marks',
      header: 'My marks',
      align: 'right',
      sortValue: (r) => r.marks,
      cell: (r) =>
        r.marks === null ? (
          <span className="text-xs text-muted-foreground">not yet</span>
        ) : (
          <span className="tabular font-medium">
            {formatMarks(r.marks)}
            <span className="text-muted-foreground"> / {r.max_marks}</span>
          </span>
        ),
    },
    {
      key: 'claims',
      header: 'My claims',
      cell: (r) =>
        r.claims_pending + r.claims_confirmed + r.claims_contested === 0 ? (
          <span className="text-xs text-muted-foreground">No claim yet</span>
        ) : (
          <ClaimCounts pending={r.claims_pending} confirmed={r.claims_confirmed} contested={r.claims_contested} />
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => opts.onClaim(r.milestone_no)} disabled={r.locked} title={r.locked ? 'Locked' : 'File a claim'}>
            <PenLine /> Claim
          </Button>
          <Button size="xs" variant="ghost" onClick={() => opts.onSubmit(r.milestone_no)} disabled={r.locked} title={r.locked ? 'Locked' : 'Submit'}>
            <Send /> Submit
          </Button>
        </div>
      ),
    },
  ]
}

function submissionColumns(
  nameOf: (usn: string) => string | undefined,
  titleOf: (artifactId: string) => string | undefined,
): Column<SubmissionRow & { title: string }>[] {
  return [
  {
    key: 'component',
    header: 'Component',
    sortValue: (r) => r.milestone_no,
    cell: (r) => (
      <span>
        <span className="font-mono text-xs text-muted-foreground">{componentLabel(r.milestone_no)}</span> {r.title}
      </span>
    ),
  },
  { key: 'attempt_no', header: 'Attempt', align: 'right', sortValue: (r) => r.attempt_no, cell: (r) => <span className="tabular">#{r.attempt_no}</span> },
  {
    key: 'frozen',
    header: 'Frozen versions',
    cell: (r) =>
      r.artifacts.length ? (
        <ul className="space-y-0.5 text-xs">
          {r.artifacts.map((a) => (
            <li key={`${a.artifact_id}@${a.version_no}`}>
              {titleOf(a.artifact_id) ?? a.artifact_id}{' '}
              <span className="font-mono text-muted-foreground">
                {a.artifact_id}@v{a.version_no}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        '—'
      ),
  },
  { key: 'submitted_by', header: 'By', cell: (r) => <PersonCell usn={r.submitted_by} name={nameOf(r.submitted_by)} /> },
  { key: 'submitted_at', header: 'When', sortValue: (r) => r.submitted_at, cell: (r) => <span className="text-xs">{formatDateTime(r.submitted_at)}</span> },
  ]
}

/** A person: name first, USN as secondary text. */
function PersonCell({ usn, name }: { usn: string; name?: string }) {
  return (
    <span className="text-xs">
      {name ?? usn}
      {name ? <span className="block font-mono text-[11px] text-muted-foreground">{usn}</span> : null}
    </span>
  )
}

function artifactColumns(usn: string | null, nameOf: (usn: string) => string | undefined): Column<ArtifactRow>[] {
  return [
    {
      key: 'title',
      header: 'Artifact',
      sortValue: (r) => r.title,
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-xs text-muted-foreground">{r.artifact_id}</span> <span className="font-medium">{r.title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {r.type} · {r.source}
            {r.external_ref ? (
              <>
                {' '}
                · <span className="font-mono">{r.external_ref}</span>
              </>
            ) : null}
          </span>
        </div>
      ),
    },
    {
      key: 'component',
      header: 'Component',
      sortValue: (r) => r.milestone_no,
      cell: (r) => <span className="font-mono text-xs">{componentLabel(r.milestone_no)}</span>,
    },
    {
      key: 'visibility',
      header: 'Visibility',
      sortValue: (r) => r.visibility,
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={r.visibility} />
          {r.visibility === 'private' ? (
            <span className="text-[11px] text-muted-foreground">{r.owner_usn === usn ? 'only you' : 'owner only'}</span>
          ) : r.visibility === 'team' ? (
            <span className="text-[11px] text-muted-foreground">faculty: metadata only</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">faculty can read it</span>
          )}
        </div>
      ),
    },
    {
      key: 'versions',
      header: 'Versions',
      align: 'right',
      sortValue: (r) => r.versions.length,
      cell: (r) => <span className="tabular">{r.versions.length}</span>,
    },
    {
      key: 'latest',
      header: 'Latest version',
      sortValue: (r) => r.latest?.created_at,
      cell: (r) =>
        r.latest ? (
          <div className="flex flex-col items-start gap-0.5 text-xs">
            <span>
              <span className="font-mono">v{r.latest.version_no}</span> · {formatDateTime(r.latest.created_at)}
            </span>
            <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
              <span title={r.latest.created_by}>{nameOf(r.latest.created_by) ?? r.latest.created_by}</span>
              <AiBadge value={r.latest.ai_assistance} />
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">none saved</span>
        ),
    },
  ]
}

const CONTRIBUTION_COLUMNS: Column<ContributionRow>[] = [
  { key: 'name', header: 'Who', sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
  {
    key: 'what',
    header: 'What',
    cell: (r) => (
      <div className="min-w-0">
        <span className="text-sm">
          {CONTRIBUTION_LABEL[r.contribution_type as keyof typeof CONTRIBUTION_LABEL] ?? r.contribution_type} on{' '}
          <span className="font-mono text-xs">{r.artifact_id}</span> {r.artifact_title}
        </span>
        {r.description ? <span className="block text-xs text-muted-foreground">{r.description}</span> : null}
      </div>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    cell: (r) => (
      <span className="text-xs">
        {r.source}
        {r.source_ref ? <span className="block font-mono text-muted-foreground">{r.source_ref}</span> : null}
      </span>
    ),
  },
  { key: 'ai', header: 'AI', cell: (r) => <AiBadge value={r.ai_assisted ? 'assisted' : 'none'} /> },
  { key: 'at', header: 'When', sortValue: (r) => r.at, cell: (r) => <span className="text-xs">{formatDateTime(r.at)}</span> },
]
