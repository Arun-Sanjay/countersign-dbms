import { ClipboardList, GraduationCap, Keyboard, Loader2, Lock, LockOpen, MessageSquareQuote, ShieldOff, Users } from 'lucide-react'
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useProfile } from '@/auth/AuthProvider'
import { LiveActivityFeed, LiveStatusChip } from '@/components/activity/LiveActivityPanel'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PanelSkeleton, StatGridSkeleton } from '@/components/Skeletons'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProjectLive, type LiveStatus } from '@/data/activity'
import {
  useComponentSignatures,
  useLabCieMarks,
  useLockMilestone,
  useMilestones,
  useProjectEvidence,
  useProjectInfo,
  useRecordAssessment,
  useRubricSheet,
  useTaughtProjects,
  useTeamProgress,
  type CieRow,
  type ComponentSignature,
  type Milestone,
  type RubricCell,
  type TeamProgress,
} from '@/data/faculty'
import { toAppError } from '@/lib/errors'
import { componentLabel, formatDate, formatDateTime, formatMarks, formatRelative, todayIso } from '@/lib/format'
import { toastError, toastSuccess } from '@/lib/notify'
import { marksSchema } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { ClaimDots, ClaimDotsLegend } from './components/ClaimDots'
import { claimSummary } from './components/claimSummary'
import { ClaimDrawer, type CellRef } from './components/ClaimDrawer'
import { LOCKED_HATCH } from './components/styles'

interface StudentRow {
  usn: string
  name: string
  teamId: string
  teamName: string
  cells: Map<number, RubricCell>
  claims: number
}

interface TeamGroup {
  teamId: string
  teamName: string
  students: StudentRow[]
}

function groupSheet(rows: RubricCell[]): TeamGroup[] {
  const teams = new Map<string, TeamGroup>()
  for (const r of rows) {
    let t = teams.get(r.team_id)
    if (!t) {
      t = { teamId: r.team_id, teamName: r.team_name, students: [] }
      teams.set(r.team_id, t)
    }
    let s = t.students.find((x) => x.usn === r.usn)
    if (!s) {
      s = { usn: r.usn, name: r.name, teamId: r.team_id, teamName: r.team_name, cells: new Map(), claims: 0 }
      t.students.push(s)
    }
    s.cells.set(r.milestone_no, r)
    s.claims += Number(r.claims_pending ?? 0) + Number(r.claims_confirmed ?? 0) + Number(r.claims_contested ?? 0)
  }
  const out = [...teams.values()].sort((a, b) => a.teamId.localeCompare(b.teamId))
  // like the paper sheet: by USN within each team
  for (const t of out) t.students.sort((a, b) => a.usn.localeCompare(b.usn))
  return out
}

/** Short column titles in the spirit of the paper sheet ("Req. Spec."); the full title is the tooltip. */
const ABBREV: Record<string, string> = {
  Requirement: 'Req.',
  Specification: 'Spec.',
  Security: 'Sec.',
  Validation: 'Valid.',
  Innovative: 'Innov.',
  Experiment: 'Expt.',
  Normalized: 'Norm.',
  and: '&',
}
/** Tighter still, for the narrow columns below 1600 px (KNOWN_ISSUES #6). */
const ABBREV_COMPACT: Record<string, string> = {
  ...ABBREV,
  Diagram: 'Diag.',
  Tables: 'Tab.',
  Midterm: 'Mid.',
  Report: 'Rep.',
}

function shortTitle(title: string, abbrev: Record<string, string> = ABBREV): string {
  return title
    .split(/\s+/)
    .map((w) => abbrev[w] ?? w)
    .join(' ')
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** /sheet/:projectId — the paper lab evaluation sheet, rebuilt as live tables. */
export default function RubricSheetPage() {
  const { projectId = '' } = useParams()
  // one page instance per project: the drawer, entry mode and the Realtime subscription
  // (its status and feed) all start fresh when the project changes
  return <RubricSheet key={projectId} projectId={projectId} />
}

function RubricSheet({ projectId }: { projectId: string }) {
  const profile = useProfile()
  const project = useProjectInfo(projectId)
  const milestones = useMilestones(projectId)
  const sheet = useRubricSheet(projectId)
  const cie = useLabCieMarks(projectId)
  const progress = useTeamProgress(projectId)
  const taught = useTaughtProjects()
  const evidence = useProjectEvidence(projectId)
  const signatures = useComponentSignatures(projectId)
  // the page holds the subscription so that its status chip can sit in the header as well as
  // on the Live activity panel below the fold (KNOWN_ISSUES #6)
  const live = useProjectLive(projectId)
  // the cell (or input) that opened the drawer gets focus back when it closes
  const returnFocus = useRef<HTMLElement | null>(null)

  const [entryMode, setEntryMode] = useState(false)
  const [selected, setSelected] = useState<CellRef | null>(null)

  const teams = useMemo(() => groupSheet(sheet.data ?? []), [sheet.data])
  const students = teams.flatMap((t) => t.students)
  const ms = milestones.data ?? []
  const reduced = ms.filter((m) => m.cie_part === 'reduced')
  const innovative = ms.find((m) => m.cie_part === 'innovative')
  const final = ms.find((m) => m.cie_part === 'final')
  const isLab = Boolean(innovative || final)
  const rawMax = reduced.reduce((s, m) => s + Number(m.max_marks), 0)
  const cieByUsn = useMemo(() => new Map((cie.data ?? []).map((r) => [r.usn, r])), [cie.data])
  const progressByTeam = useMemo(() => new Map((progress.data ?? []).map((p) => [p.team_id, p])), [progress.data])

  const visible = students.length > 0
  const canRecord = profile.role === 'faculty' && visible
  const canLock = (profile.role === 'faculty' || profile.role === 'admin') && visible
  const teachesIt = taught.data?.some((p) => p.projectId === projectId)
  // no rows because RLS filtered them (not because nobody has joined yet)
  const hiddenByRls = !visible && taught.isSuccess && !teachesIt

  const totals = useMemo(() => {
    const cells = sheet.data ?? []
    return {
      marked: cells.filter((c) => c.marks !== null).length,
      cells: cells.length,
      confirmed: cells.reduce((s, c) => s + Number(c.claims_confirmed ?? 0), 0),
      pending: cells.reduce((s, c) => s + Number(c.claims_pending ?? 0), 0),
      contested: cells.reduce((s, c) => s + Number(c.claims_contested ?? 0), 0),
    }
  }, [sheet.data])

  const openCell = (s: StudentRow, m: Milestone) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const teamSize = teams.find((t) => t.teamId === s.teamId)?.students.length
    setSelected({ usn: s.usn, name: s.name, teamId: s.teamId, teamName: s.teamName, projectId, milestone: m, teamSize })
  }
  // keep the drawer's milestone fresh (e.g. after locking it)
  const selectedLive = selected
    ? { ...selected, milestone: ms.find((m) => m.milestone_no === selected.milestone.milestone_no) ?? selected.milestone }
    : null

  const p = project.data
  const loading = project.isPending || milestones.isPending || sheet.isPending

  return (
    <>
      <PageHeader
        eyebrow={
          p
            ? `${projectId} · ${p.course_code} · ${ms.length === 0 || isLab ? 'Lab evaluation sheet' : 'Marks sheet'}`
            : projectId
        }
        title={p?.title ?? (loading ? 'Marks sheet' : 'Unknown project')}
        description={
          p
            ? `The ${isLab ? 'paper lab evaluation sheet' : 'marks sheet'}, rebuilt as live tables. Click any cell to see the claims, evidence and countersigns behind the mark.`
            : undefined
        }
        actions={
          p && ms.length > 0 ? (
            <>
              <LiveChipLink status={live.status} />
              <EntryToggle entryMode={entryMode} setEntryMode={setEntryMode} canRecord={canRecord} role={profile.role} />
              {isLab ? (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/marks/${projectId}`}>
                    <GraduationCap /> Lab CIE marks
                  </Link>
                </Button>
              ) : null}
            </>
          ) : null
        }
        meta={p && ms.length > 0 && !hiddenByRls ? <ClaimDotsLegend /> : null}
      />

      {loading ? (
        <div className="space-y-4">
          <StatGridSkeleton />
          <PanelSkeleton lines={8} />
        </div>
      ) : project.isError || milestones.isError || sheet.isError ? (
        <ErrorState
          error={project.error ?? milestones.error ?? sheet.error}
          onRetry={() => {
            void project.refetch()
            void milestones.refetch()
            void sheet.refetch()
          }}
        />
      ) : !p ? (
        <EmptyState
          icon={ClipboardList}
          title={`There is no project ${projectId}`}
          description="Pick a project from the sidebar."
          action={
            <Button asChild variant="outline">
              <Link to="/">Go to my projects</Link>
            </Button>
          }
        />
      ) : ms.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No components defined" description={`${projectId} has no milestones (rubric components) yet.`} />
      ) : (
        <div className="space-y-4">
          {hiddenByRls ? null : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Students" value={students.length} hint={plural(teams.length, 'team')} icon={Users} />
              <StatCard
                label="Cells marked"
                value={
                  <>
                    {totals.marked}
                    <span className="text-base font-normal text-muted-foreground"> / {totals.cells}</span>
                  </>
                }
                hint={`${plural(ms.length, 'component')} × ${plural(students.length, 'student')}`}
                icon={ClipboardList}
                tone="brand"
              />
              <StatCard
                label="Components locked"
                value={
                  <>
                    {ms.filter((m) => m.locked_at).length}
                    <span className="text-base font-normal text-muted-foreground"> / {ms.length}</span>
                  </>
                }
                hint="locked marks are final"
                icon={Lock}
              />
              <StatCard
                label="Claims behind the marks"
                value={totals.confirmed + totals.pending + totals.contested}
                hint={`${totals.confirmed} confirmed · ${totals.pending} pending · ${totals.contested} contested`}
                icon={MessageSquareQuote}
                tone={totals.contested > 0 ? 'contested' : 'confirmed'}
              />
            </div>
          )}

          <Panel
            title={isLab ? 'Rubric sheet' : 'Marks sheet'}
            description={
              isLab
                ? `C1–C${reduced.length} add up to ${formatMarks(rawMax)} raw and are reduced to 30; the Innovative Experiment and the Final Demo add 10 each: 50 in all.`
                : `${projectId} has no Innovative or Final component, so it is not on the lab CIE: the total is the raw sum out of ${formatMarks(rawMax)}.`
            }
            sqlId="faculty.rubric_sheet"
            flush
          >
            {!visible ? (
              <div className="px-5 pb-5">
                <EmptyState
                  compact
                  icon={hiddenByRls ? ShieldOff : Users}
                  title={hiddenByRls ? 'No rows visible to you' : 'No teams yet'}
                  description={
                    hiddenByRls
                      ? `Hidden by row-level security: you do not teach ${projectId}, so the sheet returns no rows to you.`
                      : `Nobody has joined a team of ${projectId} yet. Rows appear here as students join.`
                  }
                />
              </div>
            ) : (
              <SheetGrid
                projectId={projectId}
                teams={teams}
                reduced={reduced}
                innovative={innovative}
                final={final}
                rawMax={rawMax}
                isLab={isLab}
                cieByUsn={cieByUsn}
                cieLoading={cie.isPending}
                progressByTeam={progressByTeam}
                evidence={evidence.data}
                signatures={signatures.data}
                entryMode={entryMode && canRecord}
                canLock={canLock}
                onOpen={openCell}
                selected={selected}
              />
            )}
            {entryMode && canRecord ? (
              <p className="flex items-center gap-1.5 border-t px-5 py-2.5 text-xs text-muted-foreground">
                <Keyboard className="size-3.5" /> Type a mark and press Enter to save and move down, Tab to move across, Esc to
                undo. Each save is one <span className="font-mono">record_assessment()</span> call; the database checks the
                maximum and the lock.
              </p>
            ) : null}
          </Panel>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
            <ProgressPanel
              rows={progress.data}
              loading={progress.isPending}
              error={progress.isError ? progress.error : null}
              onRetry={() => void progress.refetch()}
              projectId={projectId}
              hiddenByRls={hiddenByRls}
            />
            <div id="live-activity" className="scroll-mt-16">
              <LiveActivityFeed
                projectId={projectId}
                live={live}
                description="New evidence for this project, live over a private Realtime channel: who, which artifact, when. Never the text. The sheet and progress refresh themselves."
              />
            </div>
          </div>
        </div>
      )}

      <ClaimDrawer cell={selectedLive} onOpenChange={(o) => !o && setSelected(null)} canRecord={canRecord} returnFocus={returnFocus} />
    </>
  )
}

/** The Live chip again, in the page header: one click scrolls to the Live activity panel. */
function LiveChipLink({ status }: { status: LiveStatus }) {
  return (
    <button
      type="button"
      className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`Realtime: ${status}. Jump to the Live activity panel`}
      onClick={() => document.getElementById('live-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      <LiveStatusChip status={status} testId="live-status-header" />
    </button>
  )
}

function EntryToggle({
  entryMode,
  setEntryMode,
  canRecord,
  role,
}: {
  entryMode: boolean
  setEntryMode: (v: boolean) => void
  canRecord: boolean
  role: string
}) {
  const button = (
    <Button
      size="sm"
      variant={entryMode ? 'default' : 'outline'}
      onClick={() => setEntryMode(!entryMode)}
      disabled={!canRecord}
      aria-pressed={entryMode}
      data-testid="entry-toggle"
    >
      <Keyboard /> {entryMode ? 'Done entering marks' : 'Enter marks'}
    </Button>
  )
  if (canRecord) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        {role === 'admin' ? 'Marks are signed by the teaching faculty; admins can view and lock.' : 'Only the faculty who teach this project record marks.'}
      </TooltipContent>
    </Tooltip>
  )
}

// ---- the grid -------------------------------------------------------------------------------------

interface SheetGridProps {
  projectId: string
  teams: TeamGroup[]
  reduced: Milestone[]
  innovative?: Milestone
  final?: Milestone
  rawMax: number
  isLab: boolean
  cieByUsn: Map<string, CieRow>
  cieLoading: boolean
  progressByTeam: Map<string, TeamProgress>
  /** usns with recorded work (contributions / versions) in this project; undefined while loading */
  evidence: Set<string> | undefined
  signatures: Map<number, ComponentSignature> | undefined
  entryMode: boolean
  canLock: boolean
  onOpen: (s: StudentRow, m: Milestone) => void
  selected: CellRef | null
}

const TH = 'h-auto border-b px-1.5 py-2 text-center align-bottom text-xs font-medium text-muted-foreground'
const TOTAL_TD = 'border-l bg-muted/30 px-2 text-center tabular'
const KEYS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }

function SheetGrid(props: SheetGridProps) {
  const { projectId, teams, reduced, innovative, final, rawMax, isLab, cieByUsn, cieLoading, progressByTeam, evidence, signatures, entryMode, canLock, onOpen, selected } =
    props
  const extras = [innovative, final].filter((m): m is Milestone => Boolean(m))
  const all = [...reduced, ...extras]
  const totalCols = 2 + all.length + (isLab ? 3 : 1)
  const tableRef = useRef<HTMLTableElement>(null)
  const markedIn = (no: number) => teams.reduce((n, t) => n + t.students.filter((s) => s.cells.get(no)?.marks != null).length, 0)
  const studentCount = teams.reduce((n, t) => n + t.students.length, 0)
  const colIndex = new Map(all.map((m, i) => [m.milestone_no, i]))
  const rowIndexOf = new Map(teams.flatMap((t) => t.students).map((s, i) => [s.usn, i]))

  // roving tabindex: the grid is ONE tab stop; arrow keys move between cells
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const onGridKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement
    if (el.dataset.r === undefined || el.dataset.c === undefined) return
    let r = Number(el.dataset.r)
    let c = Number(el.dataset.c)
    if (KEYS[e.key]) {
      r += KEYS[e.key]![0]
      c += KEYS[e.key]![1]
    } else if (e.key === 'Home') c = 0
    else if (e.key === 'End') c = all.length - 1
    else return
    const next = tableRef.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)
    if (!next) return
    e.preventDefault()
    next.focus()
    setFocus({ r, c })
  }

  return (
    <div className="relative overflow-x-auto border-t">
      <table
        ref={tableRef}
        className="w-full min-w-max border-separate border-spacing-0 text-sm"
        data-testid="rubric-grid"
      >
        <caption className="sr-only">
          Marks sheet for {projectId}: one row per student, one column per component. Use the arrow keys to move between cells
          and Enter to open the claims behind a mark.
        </caption>
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" rowSpan={2} className={cn(TH, 'sticky left-0 z-20 w-10 min-w-10 bg-muted px-2 text-left align-bottom')}>
              Sl. No.
            </th>
            <th scope="col" rowSpan={2} className={cn(TH, 'sticky left-10 z-20 min-w-40 bg-muted px-3 text-left align-bottom min-[1600px]:min-w-48 min-[1600px]:px-4')}>
              Student
            </th>
            <th scope="colgroup" colSpan={reduced.length} className={cn(TH, 'border-l pb-1 text-[11px] tracking-wide uppercase')}>
              {isLab ? `Components C1–C${reduced.length} · reduced part` : 'Components'}
            </th>
            {isLab ? (
              <>
                <th scope="colgroup" colSpan={2} className={cn(TH, 'border-l pb-1 text-[11px] tracking-wide uppercase')}>
                  Total
                </th>
                {extras.map((m) => (
                  <th key={m.milestone_no} scope="col" className={cn(TH, 'border-l pb-1 text-[11px] tracking-wide uppercase')}>
                    +{formatMarks(m.max_marks)}
                  </th>
                ))}
                <th scope="col" rowSpan={2} className={cn(TH, 'w-20 min-w-20 border-l bg-brand-soft/60 px-3 text-brand')}>
                  <div className="text-[11px] tracking-wide uppercase">Lab CIE</div>
                  <div className="pt-1 text-sm font-semibold">/50</div>
                </th>
              </>
            ) : (
              <th scope="col" rowSpan={2} className={cn(TH, 'w-20 min-w-20 border-l px-3')}>
                <div className="text-[11px] tracking-wide uppercase">Total</div>
                <div className="tabular pt-1 text-sm font-semibold text-foreground">/{formatMarks(rawMax)}</div>
              </th>
            )}
          </tr>
          <tr>
            {reduced.map((m, i) => (
              <ComponentHead
                key={m.milestone_no}
                m={m}
                first={i === 0}
                projectId={projectId}
                canLock={canLock}
                marked={markedIn(m.milestone_no)}
                students={studentCount}
              />
            ))}
            {isLab ? (
              <>
                <th scope="col" className={cn(TH, 'w-14 border-l')}>
                  <div className="text-sm font-semibold text-foreground">Raw</div>
                  <div className="tabular">/{formatMarks(rawMax)}</div>
                </th>
                <th scope="col" className={cn(TH, 'w-14')}>
                  <div className="text-sm font-semibold text-foreground" aria-hidden>
                    →
                  </div>
                  <div className="tabular">
                    <span className="sr-only">reduced to </span>/30
                  </div>
                </th>
                {extras.map((m) => (
                  <ComponentHead
                    key={m.milestone_no}
                    m={m}
                    first
                    projectId={projectId}
                    canLock={canLock}
                    marked={markedIn(m.milestone_no)}
                    students={studentCount}
                  />
                ))}
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const pr = progressByTeam.get(t.teamId)
            return (
              <Fragment key={t.teamId}>
                <tr>
                  <th scope="colgroup" colSpan={totalCols} className="border-b bg-background px-4 pt-4 pb-1.5 text-left font-normal">
                    <div className="sticky left-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-sm font-semibold">{t.teamName}</span>
                      <span className="font-mono text-muted-foreground">{t.teamId}</span>
                      <span className="text-muted-foreground">
                        {t.students.length}
                        {pr ? ` / ${pr.max_size}` : ''} members
                      </span>
                      {pr ? (
                        <span className="text-muted-foreground">
                          {plural(Number(pr.submissions ?? 0), 'submission')} · last activity {formatRelative(pr.last_activity)}
                        </span>
                      ) : null}
                    </div>
                  </th>
                </tr>
                {t.students.map((s) => {
                  const ri = rowIndexOf.get(s.usn) ?? 0
                  const c = cieByUsn.get(s.usn)
                  const rawSum = reduced.reduce((sum, m) => sum + Number(s.cells.get(m.milestone_no)?.marks ?? 0), 0)
                  const assessed = all.filter((m) => s.cells.get(m.milestone_no)?.marks != null).length
                  const provisional = assessed < all.length
                  const cellProps = (m: Milestone, first: boolean) => ({
                    cell: s.cells.get(m.milestone_no),
                    m,
                    student: s,
                    first,
                    projectId,
                    entryMode,
                    rowIndex: ri,
                    colIndex: colIndex.get(m.milestone_no) ?? 0,
                    tabStop: focus.r === ri && focus.c === (colIndex.get(m.milestone_no) ?? 0),
                    onFocusCell: setFocus,
                    onKeyDown: onGridKeyDown,
                    onOpen,
                    active: selected?.usn === s.usn && selected.milestone.milestone_no === m.milestone_no,
                  })
                  return (
                    <tr key={s.usn} className="group/row">
                      <td className="sticky left-0 z-10 w-10 min-w-10 border-b bg-card px-2 py-2 text-xs text-muted-foreground tabular group-hover/row:bg-muted">
                        {ri + 1}
                      </td>
                      <th
                        scope="row"
                        className="sticky left-10 z-10 w-44 max-w-44 border-b bg-card px-3 py-2 text-left font-normal group-hover/row:bg-muted min-[1600px]:w-52 min-[1600px]:max-w-52 min-[1600px]:px-4"
                      >
                        <div className="font-medium">{s.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono text-[11px] text-muted-foreground">{s.usn}</span>
                          {s.claims === 0 && evidence ? (
                            <StatusBadge status={evidence.has(s.usn) ? 'no_claims' : 'no_evidence'} className="h-4 px-1.5 text-[10px]" />
                          ) : null}
                        </div>
                      </th>
                      {reduced.map((m, ci) => (
                        <SheetCell key={m.milestone_no} {...cellProps(m, ci === 0)} />
                      ))}
                      {isLab ? (
                        <>
                          <td className={cn(TOTAL_TD, 'border-b text-muted-foreground')}>
                            {cieLoading ? <Dash /> : formatMarks(c ? Number(c.raw_total) : rawSum)}
                          </td>
                          <td className="border-b bg-muted/30 px-2 text-center font-semibold tabular">
                            {cieLoading ? <Dash /> : c?.reduced_30 != null ? formatMarks(Number(c.reduced_30)) : <Dash />}
                          </td>
                          {extras.map((m) => (
                            <SheetCell key={m.milestone_no} {...cellProps(m, true)} />
                          ))}
                          <td
                            className="w-20 min-w-20 border-b border-l bg-brand-soft/40 px-3 text-center"
                            title={provisional ? `Provisional: ${assessed} of ${all.length} components assessed; the rest count as 0 for now.` : 'Final: every component assessed'}
                          >
                            {cieLoading || c?.total_50 == null ? (
                              <Dash />
                            ) : (
                              <div className="flex flex-col items-center leading-tight">
                                <span className={cn('tabular text-base font-semibold', provisional ? 'text-brand/70' : 'text-brand')}>
                                  {formatMarks(Number(c.total_50))}
                                </span>
                                {provisional ? (
                                  <span className="text-[10px] whitespace-nowrap text-muted-foreground">
                                    {assessed}/{all.length} assessed
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </>
                      ) : (
                        <td className={cn(TOTAL_TD, 'w-20 min-w-20 border-b font-semibold')}>{assessed === 0 ? <Dash /> : formatMarks(rawSum)}</td>
                      )}
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2} className="sticky left-0 z-10 bg-muted px-4 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Signature of lab faculty
            </th>
            {reduced.map((m, i) => (
              <SignatureCell key={m.milestone_no} m={m} sig={signatures?.get(m.milestone_no)} first={i === 0} />
            ))}
            {isLab ? (
              <>
                <td className="border-l bg-muted/40">
                  <span className="sr-only">no signature for totals</span>
                </td>
                <td className="bg-muted/40">
                  <span className="sr-only">no signature for totals</span>
                </td>
                {extras.map((m) => (
                  <SignatureCell key={m.milestone_no} m={m} sig={signatures?.get(m.milestone_no)} first />
                ))}
                <td className="border-l bg-muted/40">
                  <span className="sr-only">no signature for totals</span>
                </td>
              </>
            ) : (
              <td className="border-l bg-muted/40">
                <span className="sr-only">no signature for totals</span>
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

/** Footer cell: who signed this column and when, or that it is locked (the paper sheet's signature row). */
function SignatureCell({ m, sig, first }: { m: Milestone; sig: ComponentSignature | undefined; first: boolean }) {
  const locked = Boolean(m.locked_at)
  return (
    <td
      className={cn('bg-muted/40 px-1 py-2 text-center align-top text-[10px] leading-tight text-muted-foreground', first && 'border-l')}
      title={
        sig
          ? `Signed by ${sig.signers.join(', ')} · last ${formatDateTime(sig.lastAt)}${locked ? ` · locked ${formatDateTime(m.locked_at)}` : ''}`
          : locked
            ? `Locked ${formatDateTime(m.locked_at)}`
            : 'No mark signed yet'
      }
    >
      {sig ? (
        <>
          <div className="font-mono font-medium text-foreground">{sig.signers.join(', ')}</div>
          <div className="whitespace-nowrap">{formatDate(sig.lastAt, '')}</div>
        </>
      ) : (
        <span aria-label="not signed">—</span>
      )}
      {locked ? (
        <div className="mt-0.5 inline-flex items-center gap-0.5 font-medium text-foreground">
          <Lock className="size-2.5" aria-hidden /> Locked
        </div>
      ) : null}
    </td>
  )
}

function ComponentHead({
  m,
  first,
  projectId,
  canLock,
  marked,
  students,
}: {
  m: Milestone
  first: boolean
  projectId: string
  canLock: boolean
  marked: number
  students: number
}) {
  const locked = Boolean(m.locked_at)
  return (
    <th
      scope="col"
      // narrower below 1600 px so that C1..C11 and Lab CIE /50 fit a 1440 px screen with the sidebar open
      className={cn(TH, 'w-[3.75rem] min-w-[3.75rem] min-[1600px]:w-[4.6rem] min-[1600px]:min-w-[4.6rem]', first && 'border-l', locked && 'bg-muted/80')}
      style={locked ? LOCKED_HATCH : undefined}
      title={`${componentLabel(m.milestone_no)} · ${m.title} (max ${formatMarks(m.max_marks)}, due ${formatDate(m.deadline)})${locked ? ` · locked ${formatDateTime(m.locked_at)}` : ''}`}
    >
      <div className="text-sm font-semibold text-foreground">{componentLabel(m.milestone_no)}</div>
      <div className="mx-auto line-clamp-2 h-[2.2em] max-w-[3.6rem] text-[10px] leading-[1.1] font-normal break-normal hyphens-auto min-[1600px]:max-w-[4.3rem]" lang="en">
        <span className="sr-only">{m.title}</span>
        <span aria-hidden className="min-[1600px]:hidden">
          {shortTitle(m.title, ABBREV_COMPACT)}
        </span>
        <span aria-hidden className="hidden min-[1600px]:inline">
          {shortTitle(m.title)}
        </span>
      </div>
      <div className="flex items-center justify-center gap-0.5 pt-0.5">
        <span className="tabular">/{formatMarks(m.max_marks)}</span>
        {locked ? (
          <span className="flex size-6 items-center justify-center">
            <Lock className="size-3.5 text-foreground/80" aria-label="Locked" />
          </span>
        ) : canLock ? (
          <LockButton m={m} projectId={projectId} marked={marked} students={students} />
        ) : null}
      </div>
    </th>
  )
}

function LockButton({ m, projectId, marked, students }: { m: Milestone; projectId: string; marked: number; students: number }) {
  const lock = useLockMilestone()
  const [typed, setTyped] = useState('')
  const code = componentLabel(m.milestone_no)
  const label = `${code} · ${m.title}`
  const early = m.deadline > todayIso()
  // locking is one-way for faculty: an empty or not-yet-due column needs the code typed
  const needsTyping = marked === 0 || early
  return (
    <ConfirmDialog
      title={`Lock ${label}?`}
      description={
        <>
          Marks for this component become final: nobody can change them, and claims and countersigns on it freeze too.
          Faculty cannot unlock a component; only an admin can.
        </>
      }
      confirmLabel="Lock component"
      tone="destructive"
      onOpenChange={() => setTyped('')}
      confirmDisabled={needsTyping && typed.trim().toUpperCase() !== code}
      trigger={
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded text-foreground/70 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Lock ${label}`}
          data-testid={`lock-${m.milestone_no}`}
        >
          <LockOpen className="size-3.5" />
        </button>
      }
      onConfirm={async () => {
        try {
          const r = await lock.mutateAsync({ projectId, milestoneNo: m.milestone_no })
          toastSuccess(
            `${code} locked`,
            `${plural(r.marks_recorded, 'mark')} final${r.unmarked > 0 ? `, ${plural(r.unmarked, 'student')} left unmarked` : ''}.`,
          )
        } catch (e) {
          toastError(e)
          throw e
        }
      }}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
        <dt className="text-muted-foreground">Deadline</dt>
        <dd className={cn(early && 'font-medium text-contested')}>
          {formatDate(m.deadline)}
          {early ? ' (not reached yet)' : ''}
        </dd>
        <dt className="text-muted-foreground">Marked</dt>
        <dd className={cn(marked < students && 'font-medium text-contested')}>
          <span className="tabular">
            {marked} of {students}
          </span>{' '}
          students{marked < students ? ': the rest stay blank once locked' : ''}
        </dd>
      </dl>
      {needsTyping ? (
        <label className="block space-y-1.5 text-sm">
          <span>
            {marked === 0 ? 'Nobody has a mark yet' : 'The deadline has not passed'}. Type{' '}
            <span className="font-mono font-semibold">{code}</span> to lock it anyway.
          </span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={`Type ${code} to confirm`} className="w-28 font-mono" />
        </label>
      ) : null}
    </ConfirmDialog>
  )
}

// ---- one cell -------------------------------------------------------------------------------------

interface SheetCellProps {
  cell: RubricCell | undefined
  m: Milestone
  student: StudentRow
  first: boolean
  projectId: string
  entryMode: boolean
  rowIndex: number
  colIndex: number
  /** roving tabindex: the one cell of the grid that is in the tab order */
  tabStop: boolean
  onFocusCell: (pos: { r: number; c: number }) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  active: boolean
  onOpen: (s: StudentRow, m: Milestone) => void
}

function SheetCell({ cell, m, student, first, projectId, entryMode, rowIndex, colIndex, tabStop, onFocusCell, onKeyDown, active, onOpen }: SheetCellProps) {
  const locked = Boolean(m.locked_at)
  const marks = cell?.marks ?? null
  const confirmed = Number(cell?.claims_confirmed ?? 0)
  const pending = Number(cell?.claims_pending ?? 0)
  const contested = Number(cell?.claims_contested ?? 0)
  // every mark should have a receipt: a mark with no claim behind it is flagged
  const noReceipt = marks !== null && confirmed + pending + contested === 0
  const dots = <ClaimDots confirmed={confirmed} pending={pending} contested={contested} />
  const base = cn(
    'h-12 border-b p-0 text-center align-middle',
    first && 'border-l',
    locked && 'bg-muted/60',
    active && 'bg-brand-soft ring-2 ring-brand/50 ring-inset',
  )
  const label = `${student.name}, ${componentLabel(m.milestone_no)} ${m.title}: ${marks === null ? 'not marked' : `${formatMarks(Number(marks))} of ${formatMarks(m.max_marks)}`}; ${noReceipt ? 'no claim behind this mark' : claimSummary(confirmed, pending, contested)}${locked ? '; locked' : ''}`

  if (entryMode && !locked) {
    return (
      <td className={base}>
        <div className="flex h-full flex-col items-center justify-center gap-0.5 px-1 py-1">
          <MarkInput student={student} m={m} projectId={projectId} marks={marks} rowIndex={rowIndex} label={label} />
          <button
            type="button"
            onClick={() => onOpen(student, m)}
            className="flex h-3 min-w-6 items-center justify-center rounded hover:bg-muted"
            aria-label={`Open claims for ${student.name}, ${componentLabel(m.milestone_no)}`}
            tabIndex={-1}
          >
            {dots ?? <span className="size-1 rounded-full bg-muted-foreground/60" />}
          </button>
        </div>
      </td>
    )
  }

  return (
    <td className={base} style={locked ? LOCKED_HATCH : undefined}>
      <button
        type="button"
        onClick={() => onOpen(student, m)}
        onFocus={() => onFocusCell({ r: rowIndex, c: colIndex })}
        onKeyDown={onKeyDown}
        tabIndex={tabStop ? 0 : -1}
        className="flex size-full min-h-12 flex-col items-center justify-center gap-1 px-1 transition-colors hover:bg-brand-soft/70 focus-visible:relative focus-visible:z-[1] focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        aria-label={label}
        data-cell={`${student.usn}:${m.milestone_no}`}
        data-r={rowIndex}
        data-c={colIndex}
      >
        <span className={cn('tabular text-sm leading-none', marks === null ? 'text-muted-foreground' : 'font-medium')}>
          {marks === null ? '·' : formatMarks(Number(marks))}
        </span>
        {noReceipt ? (
          <span className="rounded-sm px-1 text-[9px] leading-[14px] font-medium whitespace-nowrap text-contested ring-1 ring-contested/60 ring-inset" aria-hidden>
            no claim
          </span>
        ) : (
          <span className="flex h-3 items-center">{dots}</span>
        )}
      </button>
    </td>
  )
}

/** Inline marks entry: Enter saves and moves down, Tab saves and moves across, Esc undoes. */
function MarkInput({
  student,
  m,
  projectId,
  marks,
  rowIndex,
  label,
}: {
  student: StudentRow
  m: Milestone
  projectId: string
  marks: number | null
  rowIndex: number
  label: string
}) {
  const record = useRecordAssessment()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const max = Number(m.max_marks)
  const initial = marks === null ? '' : formatMarks(Number(marks))

  const commit = async (el: HTMLInputElement) => {
    const raw = el.value.trim()
    if (raw === initial) return setError(null)
    if (raw === '') {
      el.value = initial
      setError(null)
      if (marks !== null) toast.info('Mark kept', { description: 'A recorded mark can be changed but not cleared (only an admin can delete one).' })
      return
    }
    const parsed = marksSchema(max).shape.marks.safeParse(Number(raw))
    if (!parsed.success || Number.isNaN(Number(raw))) {
      const msg = parsed.success ? 'Enter a number.' : (parsed.error.issues[0]?.message ?? 'Check the marks.')
      setError(msg)
      toast.error('Check the marks', { description: `${student.name}, ${componentLabel(m.milestone_no)}: ${msg}` })
      return
    }
    setError(null)
    try {
      await record.mutateAsync({ usn: student.usn, projectId, milestoneNo: m.milestone_no, marks: parsed.data })
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    } catch (e) {
      setError(toAppError(e).message)
      toastError(e)
    }
  }

  return (
    <div className="relative">
      <input
        key={initial}
        defaultValue={initial}
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? `${componentLabel(m.milestone_no)}: 0–${formatMarks(max)}`}
        data-entry={`${m.milestone_no}:${rowIndex}`}
        disabled={record.isPending}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => void commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const next = document.querySelector<HTMLInputElement>(`[data-entry="${m.milestone_no}:${rowIndex + 1}"]`)
            if (next) next.focus()
            else e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.currentTarget.value = initial
            setError(null)
            e.currentTarget.blur()
          }
        }}
        placeholder="—"
        className={cn(
          'tabular h-7 w-12 rounded-md border bg-background text-center text-sm shadow-xs outline-none placeholder:text-muted-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
          error && 'border-destructive ring-2 ring-destructive/30',
          saved && 'border-confirmed ring-2 ring-confirmed/30',
        )}
      />
      {record.isPending ? <Loader2 className="absolute top-1.5 -right-4 size-3.5 animate-spin text-muted-foreground" /> : null}
    </div>
  )
}

// ---- team progress --------------------------------------------------------------------------------

const PROGRESS_COLUMNS: Column<TeamProgress>[] = [
  {
    key: 'team',
    header: 'Team',
    cell: (r) => (
      <span>
        <span className="font-medium">{r.team_name}</span> <span className="font-mono text-xs text-muted-foreground">{r.team_id}</span>
      </span>
    ),
    sortValue: (r) => r.team_id,
  },
  { key: 'members', header: 'Members', align: 'right', cell: (r) => `${r.members} / ${r.max_size}`, sortValue: (r) => r.members },
  { key: 'artifacts', header: 'Artifacts', align: 'right', cell: (r) => num(r.artifacts), sortValue: (r) => r.artifacts },
  { key: 'contributions', header: 'Contributions', align: 'right', cell: (r) => num(r.contributions), sortValue: (r) => r.contributions },
  { key: 'submissions', header: 'Submissions', align: 'right', cell: (r) => num(r.submissions), sortValue: (r) => r.submissions },
  {
    key: 'claims',
    header: 'Claims',
    cell: (r) => <ClaimCountBadges confirmed={r.claims_confirmed} pending={r.claims_pending} contested={r.claims_contested} />,
  },
  {
    key: 'last',
    header: 'Last activity',
    cell: (r) => <span title={formatDateTime(r.last_activity)}>{formatRelative(r.last_activity)}</span>,
    sortValue: (r) => r.last_activity ?? '',
  },
]

/** Claim counts per status; zero is drawn muted, never in an alarm colour. */
function ClaimCountBadges({ confirmed, pending, contested }: { confirmed: number | null; pending: number | null; contested: number | null }) {
  const parts = [
    ['confirmed', Number(confirmed ?? 0)],
    ['pending', Number(pending ?? 0)],
    ['contested', Number(contested ?? 0)],
  ] as const
  if (parts.every(([, n]) => n === 0)) return <span className="text-xs text-muted-foreground">none yet</span>
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map(([status, n]) =>
        n > 0 ? (
          <StatusBadge key={status} status={status} label={`${n} ${status}`} />
        ) : (
          <span key={status} className="inline-flex h-5 items-center px-1 text-xs text-muted-foreground">
            0 {status}
          </span>
        ),
      )}
    </span>
  )
}

function ProgressPanel({
  rows,
  loading,
  error,
  onRetry,
  projectId,
  hiddenByRls,
}: {
  rows: TeamProgress[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  projectId: string
  hiddenByRls: boolean
}) {
  return (
    <Panel
      title="Team progress"
      description="Counts and timestamps only: this view has no content columns, so oversight never becomes reading drafts."
      sqlId="faculty.progress"
    >
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : (
        <DataTable
          columns={PROGRESS_COLUMNS}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.team_id}
          dense
          empty={
            hiddenByRls ? (
              <EmptyState
                compact
                icon={ShieldOff}
                title={`Hidden by row-level security: you do not teach ${projectId}`}
                description="The progress view returns only the teams of projects you oversee."
              />
            ) : (
              <EmptyState compact icon={Users} title="No teams yet" />
            )
          }
        />
      )}
    </Panel>
  )
}

function num(v: number | null): ReactNode {
  return <span className="tabular">{v ?? 0}</span>
}
