import { Database, FolderKanban, GraduationCap, Users, TriangleAlert, UserRound } from 'lucide-react'
import { PERSONAS } from '@/auth/personas'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { RoleChip } from '@/components/layout/RoleChip'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { StatCard } from '@/components/StatCard'
import { SqlButton } from '@/components/sql/SqlButton'
import { Skeleton } from '@/components/ui/skeleton'
import { TABLE_GROUPS, useAppUsers, useTableCounts, type PersonaRow } from '@/data/admin'
import { useSemesterHub } from '@/data/hub'
import { formatDateTime } from '@/lib/format'
import { ProjectCards } from '@/pages/faculty/components/ProjectCards'
import { IngestionPanel } from './IngestionPanel'

function personaEmail(r: PersonaRow): string | null {
  const p = PERSONAS.find((x) =>
    r.role === 'admin' ? x.role === 'admin' : x.ref === (r.usn ?? r.faculty_id),
  )
  return p?.email ?? null
}

const PERSONA_COLUMNS: Column<PersonaRow>[] = [
  {
    key: 'name',
    header: 'Who',
    cell: (r) => (
      <div>
        <div className="font-medium">{r.student?.name ?? r.faculty?.name ?? 'Administrator'}</div>
        <div className="text-xs text-muted-foreground">{personaEmail(r) ?? 'not a demo persona'}</div>
      </div>
    ),
    sortValue: (r) => r.student?.name ?? r.faculty?.name ?? '',
  },
  {
    key: 'role',
    header: 'Role',
    cell: (r) => <RoleChip role={r.role} />,
    sortValue: (r) => r.role,
  },
  {
    key: 'ref',
    header: 'Linked record',
    cell: (r) =>
      r.usn ? (
        <span>
          <span className="font-mono text-xs">{r.usn}</span>
          <span className="text-muted-foreground">
            {' '}
            · student, sem {r.student?.semester} sec {r.student?.section}
          </span>
        </span>
      ) : r.faculty_id ? (
        <span>
          <span className="font-mono text-xs">{r.faculty_id}</span>
          <span className="text-muted-foreground"> · {r.faculty?.designation ?? 'faculty'}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">none (admin has no usn or faculty_id)</span>
      ),
    sortValue: (r) => r.usn ?? r.faculty_id ?? '',
  },
  {
    key: 'user',
    header: 'auth.users id',
    cell: (r) => (
      <span className="font-mono text-xs text-muted-foreground" title={r.user_id}>
        {r.user_id.slice(0, 8)}…
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Linked',
    cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.created_at)}</span>,
    sortValue: (r) => r.created_at,
  },
]

/** /admin — directory overview: ingestion, counts per table, personas. */
export default function AdminPage() {
  const hub = useSemesterHub()
  const counts = useTableCounts()
  const users = useAppUsers()
  const c = hub.data?.role === 'admin' ? hub.data.counts : null

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Directory"
        description="Row counts per table and the demo personas linked through app_user. An admin passes every staff policy, but still sees no one's private artifacts or notes: privacy is not a role bypass."
      />

      <div className="space-y-4">
        {hub.isError ? <ErrorState error={hub.error} onRetry={() => void hub.refetch()} /> : null}
        <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Students" value={c?.students ?? '—'} icon={Users} loading={hub.isPending} />
          <StatCard label="Faculty" value={c?.faculty ?? '—'} icon={UserRound} loading={hub.isPending} />
          <StatCard label="Projects" value={c?.projects ?? '—'} icon={FolderKanban} loading={hub.isPending} />
          <StatCard label="Teams" value={c?.teams ?? '—'} icon={GraduationCap} loading={hub.isPending} tone="brand" />
          <StatCard
            label="Contested claims"
            value={c?.claims_contested ?? '—'}
            icon={TriangleAlert}
            loading={hub.isPending}
            tone="contested"
          />
        </div>
        <p className="-mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          From one <span className="font-mono">semester_hub()</span> call, which answers per role.
          <SqlButton panelId="hub.overview" />
        </p>

        <IngestionPanel />

        <Panel
          title="Rows per table"
          description="One HEAD request per table (count=exact): PostgREST returns only the Content-Range header. Counts are what RLS lets an admin see."
          sqlId="admin.counts"
        >
          {counts.isError ? (
            <ErrorState error={counts.error} onRetry={() => void counts.refetch()} compact />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {TABLE_GROUPS.map((g) => (
                <div key={g.label} className="rounded-lg ring-1 ring-foreground/10">
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <Database className="size-3.5" /> {g.label}
                  </div>
                  <ul className="divide-y">
                    {g.tables.map((t) => (
                      <li key={t.name} className="flex items-baseline gap-2 px-3 py-1.5 text-sm" data-testid={`count-${t.name}`}>
                        <span className="font-mono text-[12.5px]">{t.name}</span>
                        {t.note ? <span className="truncate text-xs text-muted-foreground">{t.note}</span> : null}
                        <span className="tabular ml-auto font-medium">
                          {counts.isPending ? <Skeleton className="h-4 w-8" /> : (counts.data[t.name] ?? '—')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="pt-3 text-xs text-muted-foreground">
            Not counted: <span className="font-mono">private.note</span> lives in a schema the API does not expose, so not even
            an admin can count it through PostgREST.
          </p>
        </Panel>

        <Panel
          title="Personas (app_user)"
          description="auth.users → app_user → student | faculty. Everyone reads their own row; only an admin reads them all (app_user_select). Emails live in auth.users, which the API does not expose: the ones shown come from the demo persona list."
          sqlId="admin.personas"
        >
          {users.isError ? (
            <ErrorState error={users.error} onRetry={() => void users.refetch()} compact />
          ) : (
            <DataTable
              columns={PERSONA_COLUMNS}
              rows={users.data}
              loading={users.isPending}
              rowKey={(r) => r.user_id}
              dense
              empty={
                <EmptyState
                  compact
                  icon={Users}
                  title="No linked logins"
                  description="Run scripts/create_personas.py to create the demo personas."
                />
              }
            />
          )}
        </Panel>

        <Panel title="Projects" description="Every project, with its rubric sheet and lab CIE marks." sqlId="faculty.projects">
          <ProjectCards emptyHint="There are no projects yet." />
        </Panel>
      </div>
    </>
  )
}
