import { Eye, EyeOff, FileText, GraduationCap, Layers, NotebookPen, PenLine, Send, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { StatGridSkeleton } from '@/components/Skeletons'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrivateArtifacts, useWhatFacultySees, type FacultyItem, type FacultyItemKind } from '@/data/facultyView'
import { usePrivateNotes } from '@/data/notes'
import { componentLabel, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AiBadge } from './parts/ui'

const ALL = '__all__'

const KIND: Record<FacultyItemKind, { label: string; icon: LucideIcon }> = {
  artifact: { label: 'Artifact', icon: FileText },
  artifact_version: { label: 'Version', icon: Layers },
  contribution: { label: 'Contribution', icon: Users },
  chunk: { label: 'Submitted text', icon: Send },
  claim: { label: 'Claim', icon: PenLine },
  assessment: { label: 'Marks', icon: GraduationCap },
}

const TIERS: { status: 'private' | 'team' | 'submitted'; who: string; faculty: string; icon: LucideIcon; tone: string }[] = [
  {
    status: 'private',
    who: 'Only you',
    faculty: 'Nothing. Not the title, not that it exists. Private notes and private artifacts are excluded by the policies themselves.',
    icon: EyeOff,
    tone: 'text-muted-foreground',
  },
  {
    status: 'team',
    who: 'You and your team',
    faculty: 'Metadata only: that the item exists, its title, when, and declared AI assistance. Never the text.',
    icon: Users,
    tone: 'text-brand',
  },
  {
    status: 'submitted',
    who: 'Team + teaching faculty',
    faculty: 'The frozen submitted version and its text, for the projects they teach. Nothing from other courses.',
    icon: Send,
    tone: 'text-info',
  },
]

/** /faculty-view — "what my faculty sees": verify the privacy promise yourself. */
export default function FacultyViewPage() {
  const profile = useProfile()
  const items = useWhatFacultySees()
  const hiddenArtifacts = usePrivateArtifacts(profile.usn)
  const privateNotes = usePrivateNotes()
  const [project, setProject] = useState<string>(ALL)

  const projects = useMemo(() => [...new Set((items.data ?? []).map((i) => i.project_id))].sort().reverse(), [items.data])
  const rows = useMemo(
    () => (items.data ?? []).filter((i) => project === ALL || i.project_id === project),
    [items.data, project],
  )
  const count = (k: FacultyItemKind) => rows.filter((r) => r.item_kind === k).length

  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="What my faculty sees"
        description="Your own records, filtered exactly the way your faculty's access is filtered: never private items, text only once submitted, metadata otherwise."
      />

      {/* ---------- the three tiers ---------- */}
      <section className="mb-8 grid gap-3 md:grid-cols-3" aria-label="The three privacy tiers">
        {TIERS.map((t) => (
          <div key={t.status} className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between">
              <StatusBadge status={t.status} />
              <t.icon className={cn('size-4', t.tone)} aria-hidden />
            </div>
            <p className="text-sm font-medium">Who: {t.who}</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Faculty see: </span>
              {t.faculty}
            </p>
          </div>
        ))}
      </section>

      <div className="space-y-6">
        {/* ---------- counts ---------- */}
        {items.isPending ? (
          <StatGridSkeleton />
        ) : items.isError ? null : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Items your faculty can see" value={rows.length} hint="metadata rows, across your teams" icon={Eye} tone="brand" />
            <StatCard label="Claims" value={count('claim')} hint="with status and declared AI assistance" icon={PenLine} />
            <StatCard label="Submitted text" value={count('chunk')} hint="readable only because it was submitted" icon={Send} tone="confirmed" />
            <StatCard
              label="Hidden from faculty"
              value={(hiddenArtifacts.data?.length ?? 0) + (privateNotes.data?.length ?? 0)}
              hint="private artifacts + private notes"
              icon={EyeOff}
              tone="contested"
              loading={hiddenArtifacts.isPending || privateNotes.isPending}
            />
          </div>
        )}

        {/* ---------- what faculty see ---------- */}
        <Panel
          title="Visible to your faculty"
          description="Read through a security_invoker view that keeps only the rows the faculty branch of each policy would return, reduced to metadata."
          sqlId="faculty_view.items"
          actions={
            projects.length > 1 ? (
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger size="sm" className="w-36" aria-label="Project">
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
            ) : null
          }
        >
          {items.isError ? (
            <ErrorState compact error={items.error} onRetry={() => items.refetch()} />
          ) : (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              loading={items.isPending}
              rowKey={(r) => `${r.item_kind}:${r.item_ref}`}
              skeletonRows={6}
              initialSort={{ key: 'at', dir: 'desc' }}
              empty={
                <EmptyState
                  compact
                  icon={ShieldCheck}
                  title="No recorded evidence yet"
                  description="Your faculty can see nothing about you yet: you have no shared artifacts, claims or marks."
                />
              }
            />
          )}
        </Panel>

        {/* ---------- hidden ---------- */}
        <Panel
          title="Never shown to faculty"
          description="The complement: what the same policies keep away from every faculty member and admin."
          sqlId="faculty_view.hidden"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <EyeOff className="size-3.5" /> Private artifacts
              </p>
              {hiddenArtifacts.isError ? (
                <ErrorState compact error={hiddenArtifacts.error} onRetry={() => hiddenArtifacts.refetch()} />
              ) : hiddenArtifacts.isPending ? (
                <Skeleton className="h-12 w-full" />
              ) : hiddenArtifacts.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">You have no private artifacts.</p>
              ) : (
                <ul className="space-y-1.5">
                  {hiddenArtifacts.data.map((a) => (
                    <li key={a.artifact_id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                      <span className="min-w-0 truncate text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{a.artifact_id}</span> {a.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {a.project_id} · {componentLabel(a.milestone_no)}
                        <StatusBadge status="private" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <NotebookPen className="size-3.5" /> Private notes
              </p>
              {privateNotes.isError ? (
                <ErrorState compact error={privateNotes.error} onRetry={() => privateNotes.refetch()} />
              ) : privateNotes.isPending ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                  <p className="text-sm">
                    <span className="tabular font-semibold">{privateNotes.data.length}</span> private note
                    {privateNotes.data.length === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    In schema <span className="font-mono">private</span>, which the API does not expose: no policy can leak what no
                    role can select.{' '}
                    <Link to="/notes" className="text-brand hover:underline">
                      Open notes
                    </Link>
                  </p>
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}

const COLUMNS: Column<FacultyItem>[] = [
  {
    key: 'kind',
    header: 'What',
    sortValue: (r) => r.item_kind,
    cell: (r) => {
      const k = KIND[r.item_kind] ?? KIND.artifact
      return (
        <span className="inline-flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <k.icon className="size-3.5" aria-hidden />
          </span>
          <span className="text-sm">{k.label}</span>
        </span>
      )
    },
  },
  {
    key: 'label',
    header: 'Label (as faculty see it)',
    sortValue: (r) => r.label,
    cell: (r) => (
      <div className="min-w-0">
        <span className="text-sm">{r.label}</span>
        <span className="block font-mono text-[11px] text-muted-foreground">{r.item_ref}</span>
      </div>
    ),
  },
  {
    key: 'where',
    header: 'Where',
    sortValue: (r) => `${r.project_id}-${String(r.milestone_no ?? 0).padStart(2, '0')}`,
    cell: (r) => (
      <span className="font-mono text-xs">
        {r.project_id}
        {r.milestone_no !== null ? ` · ${componentLabel(r.milestone_no)}` : ''}
        {r.team_id ? ` · ${r.team_id}` : ''}
      </span>
    ),
  },
  {
    key: 'visibility',
    header: 'Tier',
    sortValue: (r) => r.visibility ?? '',
    cell: (r) => (r.visibility ? <StatusBadge status={r.visibility} /> : <span className="text-xs text-muted-foreground">—</span>),
  },
  { key: 'ai', header: 'AI declared', cell: (r) => (r.ai_assistance ? <AiBadge value={r.ai_assistance} /> : <span className="text-xs text-muted-foreground">—</span>) },
  { key: 'at', header: 'When', sortValue: (r) => r.at, cell: (r) => <span className="text-xs">{formatDateTime(r.at)}</span> },
]
