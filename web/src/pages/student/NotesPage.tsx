import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Fingerprint, Loader2, Lock, NotebookPen, Plus, RotateCw, Save, Trash2, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { StatusBadge } from '@/components/StatusBadge'
import { SqlButton } from '@/components/sql/SqlButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSemesterHub } from '@/data/hub'
import {
  API_URL,
  ApiError,
  useDeleteNote,
  useNoteVersions,
  usePrivateNotes,
  useSaveNote,
  useTeamNotes,
  type TeamNote,
} from '@/data/notes'
import type { PrivateNote, SemesterHubStudent } from '@/data/types'
import { formatDateTime, formatRelative } from '@/lib/format'
import { applyServerError, toastError, toastSuccess } from '@/lib/notify'
import { noteSchema, type NoteInput } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { AiBadge } from './parts/ui'

const NO_TEAM = '__none__'

interface MyTeamOption {
  team_id: string
  team_name: string
  project_id: string
  current: boolean
}

/** /notes — private notes (owner-only, schema private) and team notes (MongoDB via the API). */
export default function NotesPage() {
  const hubQuery = useSemesterHub()
  const hub = hubQuery.data?.role === 'student' ? (hubQuery.data as SemesterHubStudent) : undefined
  const teams = useMemo<MyTeamOption[]>(() => {
    const seen = new Map<string, MyTeamOption>()
    for (const c of hub?.courses ?? []) {
      if (c.team_id && !seen.has(c.team_id)) {
        seen.set(c.team_id, {
          team_id: c.team_id,
          team_name: c.team_name ?? c.team_id,
          project_id: c.project_id ?? '',
          current: Boolean(c.is_current_term),
        })
      }
    }
    return [...seen.values()].sort((a, b) => Number(b.current) - Number(a.current) || b.project_id.localeCompare(a.project_id))
  }, [hub])

  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Notes"
        description="Private notes only you can read, and your team's shared notes with their immutable version history."
      />
      <div className="space-y-6">
        <PrivateNotes teams={teams} />
        <TeamNotes teams={teams} teamsLoading={hubQuery.isPending} />
      </div>
    </>
  )
}

// ======================================================================================
// Private notes (Postgres schema private, owner-only RPCs)
// ======================================================================================
function PrivateNotes({ teams }: { teams: MyTeamOption[] }) {
  const notes = usePrivateNotes()
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const list = notes.data ?? []
  const current: PrivateNote | undefined =
    selected === 'new' ? undefined : list.find((n) => n.note_id === selected) ?? (selected === null ? list[0] : undefined)
  const editorKey = selected === 'new' ? 'new' : String(current?.note_id ?? 'new')

  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      <Panel
        title="Private notes"
        description="Owner-only. Not your teammates, not your faculty: the schema they live in is not exposed by the API."
        sqlId="notes.list"
        className="lg:col-span-2"
        actions={
          <Button size="sm" variant="outline" onClick={() => setSelected('new')}>
            <Plus /> New
          </Button>
        }
      >
        {notes.isError ? (
          <ErrorState compact error={notes.error} onRetry={() => notes.refetch()} />
        ) : notes.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            compact
            icon={NotebookPen}
            title="No private notes yet"
            description="Viva prep, doubts, drafts: write things here you would not share yet."
          />
        ) : (
          <ul className="space-y-1">
            {list.map((n) => {
              const active = current?.note_id === n.note_id && selected !== 'new'
              return (
                <li key={n.note_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.note_id)}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left transition-colors',
                      active ? 'bg-brand-soft ring-1 ring-brand/25' : 'hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(n.updated_at)}</span>
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{n.body || 'Empty note'}</p>
                    {n.team_id ? <span className="font-mono text-[11px] text-muted-foreground">{n.team_id}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <div className="lg:col-span-3">
        {notes.isPending ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : (
          <NoteEditor
            key={editorKey}
            note={current}
            teams={teams}
            onSaved={(id) => setSelected(id)}
            onDeleted={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

function NoteEditor({
  note,
  teams,
  onSaved,
  onDeleted,
}: {
  note: PrivateNote | undefined
  teams: MyTeamOption[]
  onSaved: (id: number) => void
  onDeleted: () => void
}) {
  const save = useSaveNote()
  const del = useDeleteNote()
  const form = useForm<NoteInput>({
    resolver: zodResolver(noteSchema),
    defaultValues: { title: note?.title ?? '', body: note?.body ?? '', team_id: note?.team_id ?? undefined },
  })

  const submit = form.handleSubmit((v) =>
    save.mutateAsync({ noteId: note?.note_id, title: v.title, body: v.body, teamId: v.team_id ?? null }).then(
      (saved) => {
        toastSuccess(note ? 'Note saved' : 'Note created', 'Only you can read it.')
        form.reset({ title: saved.title, body: saved.body, team_id: saved.team_id ?? undefined })
        onSaved(saved.note_id)
      },
      (e) => {
        applyServerError(e, form.setError, ['title', 'body', 'team_id'])
      },
    ),
  )

  const remove = () =>
    del
      .mutateAsync(note!.note_id)
      .then(() => {
        toastSuccess('Note deleted')
        onDeleted()
      })
      .catch((e) => {
        toastError(e)
        throw e
      })

  return (
    <Panel
      title={note ? 'Edit note' : 'New private note'}
      description={note ? `Created ${formatDateTime(note.created_at)} · updated ${formatRelative(note.updated_at)}` : 'Only you will ever see it.'}
      sqlId="notes.save"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <FormField label="Title" required error={form.formState.errors.title}>
            <Input placeholder="Viva prep: weak entities" {...form.register('title')} />
          </FormField>
          <Controller
            control={form.control}
            name="team_id"
            render={({ field, fieldState }) => (
              <FormField label="About team" error={fieldState.error} hint="Context only; it stays private.">
                <Select value={field.value ?? NO_TEAM} onValueChange={(v) => field.onChange(v === NO_TEAM ? undefined : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEAM}>No team</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.team_id} value={t.team_id}>
                        <span className="font-mono text-xs">{t.team_id}</span> {t.team_name}
                        <span className="text-xs text-muted-foreground"> · {t.project_id}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        </div>
        <FormField label="Body" error={form.formState.errors.body}>
          <Textarea rows={8} className="min-h-40" placeholder="Write anything…" {...form.register('body')} />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> Stored in schema <span className="font-mono">private</span>; reached only through owner-checking functions.
          </p>
          <div className="flex items-center gap-2">
            {note ? (
              <ConfirmDialog
                title="Delete this note?"
                description="It is removed for good. Erasure is a procedure you run, not a cascade."
                confirmLabel="Delete note"
                tone="destructive"
                onConfirm={remove}
                trigger={
                  <Button type="button" variant="ghost" size="sm">
                    <Trash2 /> Delete
                  </Button>
                }
              >
                <div className="flex justify-end">
                  <SqlButton panelId="notes.delete" />
                </div>
              </ConfirmDialog>
            ) : null}
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {note ? 'Save' : 'Create note'}
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  )
}

// ======================================================================================
// Team notes (FastAPI + MongoDB)
// ======================================================================================
function TeamNotes({ teams, teamsLoading }: { teams: MyTeamOption[]; teamsLoading: boolean }) {
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const teamId = picked ?? teams[0]?.team_id
  const q = useTeamNotes(teamId)
  const err = q.error
  const offline = err instanceof ApiError && err.offline

  return (
    <Panel
      title="Team notes"
      description="Shared notes live in MongoDB. Every save appends an immutable version receipt (who, when, sha256). The API checks your team membership in Postgres, as you."
      sqlId="notes.team"
      actions={
        teams.length ? (
          <Select value={teamId ?? ''} onValueChange={setPicked}>
            <SelectTrigger size="sm" className="w-56" aria-label="Team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.team_id} value={t.team_id}>
                  <span className="font-mono text-xs">{t.team_id}</span> {t.team_name}
                  <span className="text-xs text-muted-foreground"> · {t.project_id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      {teamsLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !teamId ? (
        <EmptyState compact icon={NotebookPen} title="No team yet" description="Team notes belong to a team. Join one first." />
      ) : offline ? (
        <EmptyState
          compact
          icon={WifiOff}
          title="Team notes API offline"
          description={
            <>
              <span title={`${API_URL} did not answer. To run it locally: cd api && uv run uvicorn app.main:app --port 8000 (see api/README.md)`}>
                The team notes service did not answer.
              </span>{' '}
              Private notes above still work: they live in Postgres. Try again in a moment.
            </>
          }
          action={
            <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RotateCw className={cn(q.isFetching && 'animate-spin')} /> Try again
            </Button>
          }
        />
      ) : err instanceof ApiError ? (
        <ErrorState
          compact
          error={{ code: String(err.status), details: err.code, message: err.message }}
          onRetry={() => q.refetch()}
        />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : q.data.notes.length === 0 ? (
        <EmptyState
          compact
          icon={NotebookPen}
          title="No team notes yet"
          description={`${q.data.team_name} has no notes you can see: final notes of the team, plus your own drafts.`}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {q.data.count} note{q.data.count === 1 ? '' : 's'} · you read them as a team <span className="font-medium">{q.data.access}</span>
          </p>
          <ul className="space-y-2">
            {q.data.notes.map((n) => (
              <TeamNoteItem key={n.note_id} note={n} />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function TeamNoteItem({ note }: { note: TeamNote }) {
  const [open, setOpen] = useState(false)
  const versions = useNoteVersions(open ? note.note_id : undefined)
  return (
    <li className="rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="font-mono text-xs text-muted-foreground">{note.note_id}</span> {note.title}
          </p>
          <p className="text-xs text-muted-foreground">
            by <span className="font-mono">{note.author_usn}</span> · v{note.version}
            {note.updated_at ? ` · ${formatDateTime(note.updated_at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={note.status === 'final' ? 'secondary' : 'outline'}>{note.status}</Badge>
          <StatusBadge status={note.visibility} />
          <AiBadge value={note.ai_assistance} />
        </div>
      </div>
      {note.content_withheld ? (
        <p className="mt-2 text-xs text-muted-foreground italic">Content withheld (metadata only).</p>
      ) : note.content ? (
        <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-foreground/90">{note.content}</p>
      ) : null}
      {note.tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <Badge key={t} variant="outline" className="font-normal">
              #{t}
            </Badge>
          ))}
        </div>
      ) : null}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button size="xs" variant="ghost" className="mt-1 -ml-2 text-muted-foreground">
            <Fingerprint /> {note.history.versions} version receipt{note.history.versions === 1 ? '' : 's'}
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {versions.isPending ? (
            <Skeleton className="mt-1 h-10 w-full" />
          ) : versions.isError ? (
            <p className="mt-1 text-xs text-destructive">{(versions.error as Error).message}</p>
          ) : (
            <ol className="mt-1 space-y-1 border-l pl-3">
              {versions.data.versions.map((v) => (
                <li key={v.version_id} className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{v.version_id}</span> · {v.author_usn} · {formatDateTime(v.created_at)} ·{' '}
                  <span className="font-mono" title={v.content_hash}>
                    sha256 {v.content_hash.slice(0, 12)}…
                  </span>
                  {v.backfilled ? ' · backfilled' : ''}
                </li>
              ))}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
