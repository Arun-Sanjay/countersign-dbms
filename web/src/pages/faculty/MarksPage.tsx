import { Calculator, ClipboardList, Download, GraduationCap, Info, ShieldOff, Sigma, Users } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PanelSkeleton, StatGridSkeleton } from '@/components/Skeletons'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { downloadText, toCsv, useLabCieMarks, useMilestones, useProjectInfo, useTaughtProjects, type CieRow } from '@/data/faculty'
import { formatMarks } from '@/lib/format'
import { toastSuccess } from '@/lib/notify'

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))

/**
 * Components with a mark, out of all of them (C1–C9 reduced + C10 + C11): the same count as the
 * marks sheet's "n/11 assessed". The view's components_assessed counts the reduced ones only.
 */
const assessedOf = (r: CieRow) =>
  Number(r.components_assessed ?? 0) + (r.innovative_10 !== null ? 1 : 0) + (r.final_10 !== null ? 1 : 0)

function columns(reducedCount: number, componentCount: number): Column<CieRow>[] {
  const complete = (r: CieRow) => Number(r.components_assessed) === reducedCount && r.innovative_10 !== null && r.final_10 !== null
  return [
    {
      key: 'name',
      header: 'Student',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{r.usn}</div>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'team',
      header: 'Team',
      cell: (r) => <span className="font-mono text-xs">{r.team_id}</span>,
      sortValue: (r) => r.team_id,
    },
    {
      key: 'assessed',
      header: `Assessed /${componentCount}`,
      align: 'right',
      cell: (r) => (
        <span
          className="tabular text-muted-foreground"
          title={`${assessedOf(r)} of ${componentCount} components assessed: ${r.components_assessed} of ${reducedCount} reduced, plus C10 and C11 when recorded`}
        >
          {assessedOf(r)} / {componentCount}
        </span>
      ),
      sortValue: (r) => assessedOf(r),
    },
    {
      key: 'raw',
      header: 'Raw',
      align: 'right',
      cell: (r) => (
        <span className="tabular">
          {formatMarks(n(r.raw_total))}
          <span className="text-muted-foreground"> / {formatMarks(n(r.raw_max))}</span>
        </span>
      ),
      sortValue: (r) => n(r.raw_total),
    },
    {
      key: 'reduced',
      header: 'Reduced /30',
      align: 'right',
      cell: (r) => <span className="tabular font-medium">{formatMarks(n(r.reduced_30))}</span>,
      sortValue: (r) => n(r.reduced_30),
    },
    {
      key: 'innovative',
      header: 'C10 /10',
      align: 'right',
      cell: (r) => <span className="tabular">{formatMarks(n(r.innovative_10))}</span>,
      sortValue: (r) => n(r.innovative_10),
    },
    {
      key: 'final',
      header: 'C11 /10',
      align: 'right',
      cell: (r) => <span className="tabular">{formatMarks(n(r.final_10))}</span>,
      sortValue: (r) => n(r.final_10),
    },
    {
      key: 'total',
      header: 'Total /50',
      align: 'right',
      cell: (r) =>
        complete(r) ? (
          <span className="tabular text-base font-semibold text-brand">{formatMarks(n(r.total_50))}</span>
        ) : (
          <span className="inline-flex flex-col items-end leading-tight" title="Provisional: components not yet assessed count as 0">
            <span className="tabular text-base font-semibold text-brand/70">{formatMarks(n(r.total_50))}</span>
            <span className="text-[10px] text-muted-foreground">provisional</span>
          </span>
        ),
      sortValue: (r) => n(r.total_50),
    },
  ]
}

/** /marks/:projectId — lab CIE marks out of 50 (120 raw -> 30, + C10 + C11). */
export default function MarksPage() {
  const { projectId = '' } = useParams()
  const project = useProjectInfo(projectId)
  const milestones = useMilestones(projectId)
  const cie = useLabCieMarks(projectId)
  const taught = useTaughtProjects()
  const teachesIt = taught.data?.some((p) => p.projectId === projectId)

  const ms = milestones.data ?? []
  const reducedCount = ms.filter((m) => m.cie_part === 'reduced').length
  const isLab = ms.some((m) => m.cie_part !== 'reduced')
  const cols = useMemo(() => columns(reducedCount, ms.length), [reducedCount, ms.length])
  const rows = useMemo(() => cie.data ?? [], [cie.data])

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const totals = rows.map((r) => Number(r.total_50 ?? 0))
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const complete = rows.filter(
      (r) => Number(r.components_assessed) === reducedCount && r.innovative_10 !== null && r.final_10 !== null,
    ).length
    return { avg, max: Math.max(...totals), complete }
  }, [rows, reducedCount])

  const example = rows[0]
  // no rows because RLS filtered them (the app knows: it has the teaching list)
  const hiddenByRls = rows.length === 0 && taught.isSuccess && !teachesIt

  const exportCsv = () => {
    const csv = toCsv(
      ['usn', 'name', 'team_id', 'project_id', 'raw_total', 'raw_max', 'components_assessed', 'reduced_30', 'innovative_10', 'final_10', 'total_50'],
      rows.map((r) => [
        r.usn,
        r.name,
        r.team_id,
        r.project_id,
        n(r.raw_total),
        n(r.raw_max),
        r.components_assessed,
        n(r.reduced_30),
        n(r.innovative_10),
        n(r.final_10),
        n(r.total_50),
      ]),
    )
    downloadText(`lab_cie_marks_${projectId}.csv`, csv)
    toastSuccess('CSV downloaded', `${rows.length} students, exactly the rows v_lab_cie_marks returned to you.`)
  }

  const loading = project.isPending || milestones.isPending || cie.isPending

  return (
    <>
      <PageHeader
        eyebrow={`${projectId}${project.data ? ` · ${project.data.course_code}` : ''} · Lab CIE`}
        title="Lab CIE marks"
        description={
          isLab || loading
            ? `C1–C${reducedCount || 9} (raw) reduced to 30, plus the Innovative Experiment and the Final Demo out of 10 each: 50 in all. Derived in a view on every read, never stored, so it cannot drift from the marks sheet.`
            : undefined
        }
        actions={
          project.data ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to={`/sheet/${projectId}`}>
                  <ClipboardList /> {isLab ? 'Rubric sheet' : 'Marks sheet'}
                </Link>
              </Button>
              {isLab ? (
                <Button size="sm" onClick={exportCsv} disabled={rows.length === 0} data-testid="export-csv">
                  <Download /> Export CSV
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {loading ? (
        <div className="space-y-4">
          <StatGridSkeleton />
          <PanelSkeleton lines={6} />
        </div>
      ) : project.isError || milestones.isError || cie.isError ? (
        <ErrorState
          error={project.error ?? milestones.error ?? cie.error}
          onRetry={() => {
            void project.refetch()
            void milestones.refetch()
            void cie.refetch()
          }}
        />
      ) : !project.data ? (
        <EmptyState icon={GraduationCap} title={`There is no project ${projectId}`} description="Pick a project from the sidebar." />
      ) : !isLab ? (
        <EmptyState
          icon={GraduationCap}
          title={`${projectId} is not on the lab CIE`}
          description={`The lab CIE lists only lab-structured projects: those with an Innovative Experiment or a Final Demo component. ${projectId} has ${ms.length} component${ms.length === 1 ? '' : 's'}, all counted as raw marks; see its marks sheet.`}
          action={
            <Button asChild variant="outline">
              <Link to={`/sheet/${projectId}`}>Open the marks sheet</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {hiddenByRls ? null : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Students" value={rows.length} hint="rows RLS lets you read" icon={Users} />
            <StatCard
              label={stats && stats.complete < rows.length ? 'Class average (provisional)' : 'Class average'}
              value={
                stats ? (
                  <>
                    {formatMarks(Math.round(stats.avg * 10) / 10)}
                    <span className="text-base font-normal text-muted-foreground"> / 50</span>
                  </>
                ) : (
                  '—'
                )
              }
              hint={
                stats && stats.complete < rows.length
                  ? 'provisional: components not yet assessed count as 0'
                  : 'every component assessed'
              }
              icon={Sigma}
              tone="brand"
            />
            <StatCard
              label="Highest total"
              value={
                stats ? (
                  <>
                    {formatMarks(stats.max)}
                    <span className="text-base font-normal text-muted-foreground"> / 50</span>
                  </>
                ) : (
                  '—'
                )
              }
              icon={GraduationCap}
            />
            <StatCard
              label="Fully assessed"
              value={
                <>
                  {stats?.complete ?? 0}
                  <span className="text-base font-normal text-muted-foreground"> / {rows.length}</span>
                </>
              }
              hint={`all ${ms.length} components (${reducedCount} reduced + C10 + C11)`}
              icon={Calculator}
            />
          </div>
          )}

          <Panel
            title="Lab CIE marks per student"
            description="One row per student in a lab-structured project you oversee (a student sees only their own row)."
            sqlId="faculty.lab_cie_marks"
          >
            <DataTable
              columns={cols}
              rows={rows}
              rowKey={(r) => r.usn}
              initialSort={{ key: 'team', dir: 'asc' }}
              empty={
                hiddenByRls ? (
                  <EmptyState
                    compact
                    icon={ShieldOff}
                    title="No rows visible to you"
                    description={`Hidden by row-level security: you do not teach ${projectId}, so its marks are not returned to you.`}
                  />
                ) : (
                  <EmptyState compact icon={Users} title="No students yet" description={`Nobody has joined a team of ${projectId} yet.`} />
                )
              }
            />
          </Panel>

          <section className="flex gap-3 rounded-xl border border-dashed p-4 text-sm" aria-labelledby="rounding-note">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1.5 text-muted-foreground">
              <p id="rounding-note" className="font-medium text-foreground">
                Rounding assumption (to be confirmed with the course faculty)
              </p>
              <p>
                The reduced mark is <span className="font-mono text-foreground">round(raw × 30 / raw_max, 1)</span>: rounded once,
                to one decimal, half away from zero (PostgreSQL <span className="font-mono">NUMERIC</span> round). The /50 total
                adds that rounded value to C10 and C11 as recorded. A component not yet assessed counts as 0, so totals rise as
                marking progresses; the Assessed column shows how far it has got.
              </p>
              {example ? (
                <p>
                  Example, {example.name}: {formatMarks(n(example.raw_total))} × 30 / {formatMarks(n(example.raw_max))} ={' '}
                  {(Number(example.raw_total) * 30 / Number(example.raw_max)).toFixed(3)} → {formatMarks(n(example.reduced_30))}, plus{' '}
                  {formatMarks(n(example.innovative_10), '0')} + {formatMarks(n(example.final_10), '0')} ={' '}
                  <span className="font-medium text-foreground">{formatMarks(n(example.total_50))}</span> / 50.
                </p>
              ) : null}
              <p>
                If the department rounds differently (e.g. up to the next whole mark), only the view changes; no stored mark does.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
