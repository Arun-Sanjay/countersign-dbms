import { Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { SqlButton } from '@/components/sql/SqlButton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSubmitMilestone, type ArtifactRow, type ComponentRow, type SubmissionRow } from '@/data/projects'
import { errorTag, toAppError, type AppError } from '@/lib/errors'
import { componentLabel, formatDateTime } from '@/lib/format'
import { toastSuccess } from '@/lib/notify'
import { submitSchema } from '@/lib/rules'
import { cn } from '@/lib/utils'

interface Props {
  projectId: string
  teamId: string
  component: ComponentRow | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  artifacts: ArtifactRow[]
  submissions: SubmissionRow[]
}

/** submit_milestone: freeze the latest version of each chosen artifact, in one transaction. */
export function SubmitDialog({ projectId, teamId, component, open, onOpenChange, artifacts, submissions }: Props) {
  const submit = useSubmitMilestone(projectId)
  const no = component?.milestone_no ?? 0
  const filed = artifacts.filter((a) => a.milestone_no === no)
  const previous = submissions.filter((s) => s.milestone_no === no)
  // The parent remounts this dialog (key) each time it opens, so this seeds once per opening.
  const [picked, setPicked] = useState<string[]>(() =>
    filed.filter((a) => a.visibility !== 'private' && a.latest).map((a) => a.artifact_id),
  )
  const [error, setError] = useState<AppError | null>(null)

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const run = () => {
    setError(null)
    const parsed = submitSchema.safeParse({ milestone_no: no, artifact_ids: picked })
    if (!parsed.success) {
      setError({ kind: 'validation', title: 'Nothing selected', message: parsed.error.issues[0]?.message ?? 'Choose an artifact.' })
      return
    }
    submit.mutate(
      { teamId, milestoneNo: no, artifactIds: picked },
      {
        onSuccess: (r) => {
          toastSuccess(
            `Submitted ${componentLabel(no)} · attempt ${r.attempt_no}`,
            `Frozen: ${r.artifacts.map((a) => `${a.artifact_id}@v${a.version_no}`).join(', ')}. Your teaching faculty can now read them.`,
          )
          onOpenChange(false)
        },
        onError: (e) => setError(toAppError(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submit.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Submit {componentLabel(no)} · {component?.component}
          </DialogTitle>
          <DialogDescription>
            The latest version of each artifact you choose is frozen into this submission and becomes visible to your teaching
            faculty (team → submitted). Private artifacts cannot be submitted.
          </DialogDescription>
        </DialogHeader>

        {component?.locked ? (
          <div className="rounded-lg bg-muted p-3 text-sm">
            <StatusBadge status="locked" /> This component is locked: it accepts no new submissions.
          </div>
        ) : null}

        {filed.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No artifact is filed under {componentLabel(no)} yet.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="pb-1 text-sm font-medium">Artifacts filed under {componentLabel(no)}</legend>
            {filed.map((a) => {
              const disabled = a.visibility === 'private' || !a.latest
              return (
                <label
                  key={a.artifact_id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg p-2.5 ring-1 ring-foreground/10',
                    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={picked.includes(a.artifact_id)}
                    onChange={() => toggle(a.artifact_id)}
                    disabled={disabled}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{a.artifact_id}</span> {a.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.latest ? `latest v${a.latest.version_no}` : 'no saved version'}
                      {a.visibility === 'private' ? ' · private: share it with the team first' : ''}
                    </span>
                  </span>
                  <StatusBadge status={a.visibility} />
                </label>
              )
            })}
          </fieldset>
        )}

        {previous.length ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium">Earlier attempts</p>
            {previous.map((s) => (
              <p key={s.submission_id}>
                Attempt {s.attempt_no} · {formatDateTime(s.submitted_at)} ·{' '}
                <span className="font-mono">{s.artifacts.map((x) => `${x.artifact_id}@v${x.version_no}`).join(', ')}</span>
              </p>
            ))}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">{error.title}</p>
            <p className="text-muted-foreground">{error.message}</p>
            {errorTag(error) ? <p className="font-mono text-xs text-muted-foreground/80">{errorTag(error)}</p> : null}
          </div>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <SqlButton panelId="project.submit" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
              Cancel
            </Button>
            <Button onClick={run} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Submit {picked.length ? `${picked.length} artifact${picked.length === 1 ? '' : 's'}` : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
