import { zodResolver } from '@hookform/resolvers/zod'
import {
  CircleCheck,
  FileCode2,
  FilePen,
  GitCommitHorizontal,
  Link2,
  Loader2,
  Lock,
  MessageSquareQuote,
  PenLine,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AiBadge } from '@/components/AiBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { FormField } from '@/components/FormField'
import { PanelSkeleton } from '@/components/Skeletons'
import { SqlButton } from '@/components/sql/SqlButton'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  useArtifactVersions,
  useCellAssessment,
  useCellClaims,
  useComponentClaims,
  useRecordAssessment,
  type CellClaim,
  type CellEvidence,
  type Milestone,
} from '@/data/faculty'
import { componentLabel, formatDate, formatDateTime, formatMarks } from '@/lib/format'
import { applyServerError, toastSuccess } from '@/lib/notify'
import { marksSchema } from '@/lib/rules'
import { cn } from '@/lib/utils'

export interface CellRef {
  usn: string
  name: string
  teamId: string
  teamName: string
  projectId: string
  milestone: Milestone
}

interface ClaimDrawerProps {
  cell: CellRef | null
  onOpenChange: (open: boolean) => void
  /** Faculty who teach the project may record marks (admins only view and lock). */
  canRecord: boolean
  /** Scroll to and ring this claim (the contested queue opens a specific claim). */
  highlightClaimId?: number
  /** Extra header actions, e.g. "Open in rubric sheet". */
  actions?: ReactNode
  /** Where focus goes when the drawer closes (the cell that opened it). */
  returnFocus?: RefObject<HTMLElement | null>
}

/** Right drawer: one rubric cell -> its mark, and the claims -> evidence -> countersigns behind it. */
export function ClaimDrawer({ cell, onOpenChange, canRecord, highlightClaimId, actions, returnFocus }: ClaimDrawerProps) {
  const claims = useCellClaims(cell ? { usn: cell.usn, projectId: cell.projectId, milestoneNo: cell.milestone.milestone_no } : null)
  const m = cell?.milestone
  const locked = Boolean(m?.locked_at)

  useEffect(() => {
    if (!highlightClaimId || !claims.data) return
    const el = document.getElementById(`claim-${highlightClaimId}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlightClaimId, claims.data])

  return (
    <Sheet open={Boolean(cell)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 outline-none sm:max-w-xl"
        aria-describedby={undefined}
        // focus the panel, not its first button: a focused SQL pill would open its tooltip and
        // swallow the first Escape
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        // opened from a grid cell (not a Radix trigger): send focus back to that cell
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.current
          if (el?.isConnected) {
            e.preventDefault()
            el.focus()
          }
        }}
      >
        {cell && m ? (
          <>
            <SheetHeader className="gap-1.5 border-b px-5 pt-5 pb-4">
              <div className="flex items-center gap-2 pr-8 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <span>
                  {cell.projectId} · {componentLabel(m.milestone_no)} · max {formatMarks(m.max_marks)}
                </span>
                {locked ? <StatusBadge status="locked" /> : null}
              </div>
              <SheetTitle className="text-lg font-semibold tracking-tight">{m.title}</SheetTitle>
              <SheetDescription>
                <span className="font-medium text-foreground">{cell.name}</span>{' '}
                <span className="font-mono text-xs">{cell.usn}</span> · {cell.teamName} ({cell.teamId}) · due{' '}
                {formatDate(m.deadline)}
              </SheetDescription>
              {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
            </SheetHeader>

            <div className="space-y-6 px-5 py-5">
              <MarkSection cell={cell} canRecord={canRecord} />

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Claims behind this cell</h3>
                    <p className="text-xs text-muted-foreground">Claim → evidence → teammates&apos; countersigns</p>
                  </div>
                  <SqlButton panelId="faculty.claim_drawer" />
                </div>
                {claims.isPending ? (
                  <PanelSkeleton lines={3} />
                ) : claims.isError ? (
                  <ErrorState error={claims.error} onRetry={() => void claims.refetch()} compact />
                ) : claims.data.length === 0 ? (
                  <EmptyState
                    compact
                    icon={MessageSquareQuote}
                    title="No recorded evidence yet"
                    description={`${cell.name.split(' ')[0] ?? 'This student'} has not filed a claim for ${componentLabel(m.milestone_no)}. That is not a verdict: claims are filed from the student's project page and appear here.`}
                  />
                ) : (
                  <ol className="space-y-3">
                    {claims.data.map((c) => (
                      <ClaimCard key={c.claim_id} claim={c} highlighted={c.claim_id === highlightClaimId} />
                    ))}
                  </ol>
                )}
                {claims.data?.some((c) => c.status === 'contested') ? (
                  <OtherSide cell={cell} claims={claims.data} />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Staff see claims and their metadata. Evidence that points at a private artifact is hidden by
                  row-level security, and text is readable only once it is submitted.
                </p>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// ---- marks -------------------------------------------------------------------------------------

function MarkSection({ cell, canRecord }: { cell: CellRef; canRecord: boolean }) {
  const m = cell.milestone
  const locked = Boolean(m.locked_at)
  const assessment = useCellAssessment({ usn: cell.usn, projectId: cell.projectId, milestoneNo: m.milestone_no })

  return (
    <section className="space-y-3 rounded-xl bg-muted/40 p-4 ring-1 ring-foreground/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Mark</h3>
          {assessment.isPending ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : assessment.data ? (
            <p className="text-xs text-muted-foreground">
              Signed by {assessment.data.faculty?.name ?? assessment.data.assessed_by} · {formatDateTime(assessment.data.assessed_at)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Not marked yet</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right whitespace-nowrap">
            <span className="tabular text-2xl font-semibold tracking-tight">
              {assessment.data ? formatMarks(Number(assessment.data.marks)) : '—'}
            </span>
            <span className="text-sm text-muted-foreground"> / {formatMarks(m.max_marks)}</span>
          </div>
          <SqlButton panelId="faculty.record_mark" />
        </div>
      </div>
      {assessment.isError ? <ErrorState error={assessment.error} compact /> : null}
      {assessment.data?.remarks ? (
        <p className="rounded-md bg-background px-3 py-2 text-sm text-muted-foreground ring-1 ring-foreground/5">
          “{assessment.data.remarks}”
        </p>
      ) : null}
      {locked ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" /> Locked {formatDateTime(m.locked_at)}: this mark is final. Only an admin can unlock it.
        </p>
      ) : canRecord && !assessment.isPending ? (
        <MarkForm
          key={`${cell.usn}-${m.milestone_no}-${assessment.data?.assessed_at ?? 'new'}`}
          cell={cell}
          initialMarks={assessment.data ? Number(assessment.data.marks) : undefined}
          initialRemarks={assessment.data?.remarks ?? ''}
        />
      ) : !canRecord ? (
        <p className="text-xs text-muted-foreground">Marks are recorded and signed by the faculty who teach this project.</p>
      ) : null}
    </section>
  )
}

function MarkForm({ cell, initialMarks, initialRemarks }: { cell: CellRef; initialMarks?: number; initialRemarks: string }) {
  const m = cell.milestone
  const max = Number(m.max_marks)
  const schema = marksSchema(max)
  type Values = z.input<typeof schema>
  const record = useRecordAssessment()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { marks: initialMarks, remarks: initialRemarks },
  })

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const r = await record.mutateAsync({
        usn: cell.usn,
        projectId: cell.projectId,
        milestoneNo: m.milestone_no,
        marks: v.marks,
        remarks: v.remarks ?? '',
      })
      toastSuccess(
        `${componentLabel(m.milestone_no)} ${r.inserted ? 'recorded' : 'updated'}: ${formatMarks(Number(r.marks))} / ${formatMarks(max)}`,
        `${cell.name}, signed as ${r.assessed_by}`,
      )
    } catch (e) {
      applyServerError(e, form.setError, ['marks', 'remarks'])
    }
  })

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-3 sm:grid-cols-[8rem_1fr]" noValidate>
      <FormField label={`Marks (0–${formatMarks(max)})`} error={form.formState.errors.marks}>
        <Input
          type="number"
          inputMode="decimal"
          step="0.5"
          min={0}
          max={max}
          className="tabular"
          {...form.register('marks', { valueAsNumber: true })}
        />
      </FormField>
      <FormField label="Remarks" hint="Optional, up to 200 characters" error={form.formState.errors.remarks}>
        <Textarea rows={1} className="min-h-8" {...form.register('remarks')} />
      </FormField>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <PenLine />}
          {initialMarks === undefined ? 'Record mark' : 'Update mark'}
        </Button>
        <span className="text-xs text-muted-foreground">Signed in your name; the database checks the maximum and the lock.</span>
      </div>
    </form>
  )
}

// ---- claim card ----------------------------------------------------------------------------------

function ClaimCard({ claim, highlighted }: { claim: CellClaim; highlighted: boolean }) {
  return (
    <li
      id={`claim-${claim.claim_id}`}
      className={cn(
        'rounded-xl bg-card ring-1 ring-foreground/10',
        highlighted && 'ring-2 ring-brand/60',
        claim.status === 'contested' && 'border-l-2 border-l-contested',
      )}
    >
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={claim.status} />
          <span className="font-mono text-xs text-muted-foreground">
            #{claim.claim_id} · revision {claim.revision}
          </span>
          {claim.contribution_type ? (
            <span className="rounded-full bg-muted px-2 text-xs leading-5 text-muted-foreground">{claim.contribution_type}</span>
          ) : null}
          <AiBadge value={claim.ai_assistance} className="ml-auto" />
        </div>
        <p className="text-sm leading-relaxed text-pretty">“{claim.statement}”</p>
      </div>

      <div className="border-t px-4 py-3">
        <h4 className="pb-2 text-xs font-medium text-muted-foreground">Evidence ({claim.claim_evidence.length})</h4>
        {claim.claim_evidence.length === 0 ? (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-contested">
            <TriangleAlert className="size-3.5" aria-hidden /> No receipt: no evidence attached (or none visible to you).
          </p>
        ) : (
          <ul className="space-y-2">
            {claim.claim_evidence.map((e) => (
              <EvidenceItem key={e.evidence_no} e={e} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-4 py-3">
        <h4 className="pb-2 text-xs font-medium text-muted-foreground">Timeline</h4>
        <ol className="relative space-y-3 border-l border-border pl-4">
          <TimelineItem icon={MessageSquareQuote} tone="muted" at={claim.created_at}>
            Filed by <span className="font-medium">{claim.claimant?.name ?? claim.usn}</span>
          </TimelineItem>
          {claim.countersign.map((cs) => (
            <TimelineItem
              key={cs.endorser_usn}
              icon={cs.verdict === 'confirm' ? CircleCheck : TriangleAlert}
              tone={cs.verdict === 'confirm' ? 'confirmed' : 'contested'}
              at={cs.signed_at}
            >
              <span className="font-medium">{cs.endorser?.name ?? cs.endorser_usn}</span>{' '}
              {cs.verdict === 'confirm' ? 'confirmed' : 'disputed'} revision {cs.claim_revision}
              {cs.claim_revision !== claim.revision ? (
                <span className="text-muted-foreground"> (claim is now at revision {claim.revision})</span>
              ) : null}
              {cs.comment ? <span className="mt-1 block text-muted-foreground">“{cs.comment}”</span> : null}
            </TimelineItem>
          ))}
          {claim.countersign.length === 0 ? (
            <TimelineItem icon={PenLine} tone="pending">
              <span className="text-muted-foreground">Waiting for a teammate&apos;s countersign</span>
            </TimelineItem>
          ) : null}
        </ol>
      </div>
    </li>
  )
}

const TONE_CLASS = {
  muted: 'bg-muted text-muted-foreground',
  confirmed: 'bg-confirmed-soft text-confirmed',
  contested: 'bg-contested-soft text-contested',
  pending: 'bg-pending-soft text-pending',
} as const

function TimelineItem({
  icon: Icon,
  tone,
  at,
  children,
}: {
  icon: LucideIcon
  tone: keyof typeof TONE_CLASS
  at?: string
  children: ReactNode
}) {
  return (
    <li className="relative text-sm">
      <span
        className={cn('absolute top-0.5 -left-[25px] flex size-4.5 items-center justify-center rounded-full ring-2 ring-card', TONE_CLASS[tone])}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="leading-snug">{children}</div>
      {at ? <div className="pt-0.5 text-xs text-muted-foreground">{formatDateTime(at)}</div> : null}
    </li>
  )
}

const KIND_ICON: Record<string, LucideIcon> = {
  contribution: FilePen,
  artifact_version: FileCode2,
  commit: GitCommitHorizontal,
  url: Link2,
  file: FileCode2,
}

function EvidenceItem({ e }: { e: CellEvidence }) {
  const Icon = KIND_ICON[e.kind] ?? FileCode2
  let main: ReactNode
  let meta: ReactNode = null
  if (e.kind === 'contribution' && e.contribution) {
    const k = e.contribution
    main = (
      <>
        {k.contribution_type}: {k.description ?? 'contribution'}
      </>
    )
    meta = (
      <>
        contribution #{e.contribution_id} · {k.source}
        {k.source_ref ? <span className="font-mono"> {k.source_ref}</span> : null}
        {k.occurred_at ? ` · ${formatDateTime(k.occurred_at)}` : null}
        {k.ai_assisted ? ' · AI declared: assisted' : null}
      </>
    )
  } else if (e.kind === 'artifact_version') {
    const v = e.artifact_version
    main = (
      <>
        {v?.artifact?.title ?? 'Artifact'}{' '}
        <span className="font-mono text-xs text-muted-foreground">
          {e.artifact_id}@v{e.version_no}
        </span>
      </>
    )
    meta = v ? (
      <>
        version by {v.author?.name ?? v.created_by} <span className="font-mono">{v.created_by}</span> · {formatDateTime(v.created_at)}
        {v.ai_assistance !== 'none' ? ` · AI declared: ${v.ai_assistance}` : null}
        {v.artifact ? (
          <StatusBadge status={v.artifact.visibility} className="ml-1.5 h-4 align-middle text-[10px]" />
        ) : null}
      </>
    ) : null
  } else if (e.kind === 'url' && e.ref) {
    main = (
      <a href={e.ref} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline-offset-2 hover:underline">
        {e.ref}
      </a>
    )
  } else {
    main = <span className="font-mono text-xs break-all">{e.ref}</span>
    meta = e.kind
  }
  return (
    <li className="flex gap-2.5 text-sm">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 space-y-0.5">
        <div className="leading-snug">
          <span className="font-mono text-xs text-muted-foreground">#{e.evidence_no} </span>
          {main}
        </div>
        {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
        {e.note ? <div className="text-xs text-muted-foreground italic">note: {e.note}</div> : null}
      </div>
    </li>
  )
}

// ---- both sides of a dispute ---------------------------------------------------------------------

/**
 * A contested claim has two sides: the disputing teammates' own claims on the same component
 * (with their evidence) and the version history of the artifacts the claims cite, so
 * "see version 2" in a dispute comment can be checked right here.
 */
function OtherSide({ cell, claims }: { cell: CellRef; claims: CellClaim[] }) {
  const m = cell.milestone
  const all = useComponentClaims({ teamId: cell.teamId, projectId: cell.projectId, milestoneNo: m.milestone_no })
  const disputers = new Set(
    claims.flatMap((c) => c.countersign.filter((cs) => cs.verdict === 'dispute').map((cs) => cs.endorser_usn)),
  )
  const others = (all.data ?? []).filter((c) => c.usn !== cell.usn)
  // the disputers' claims first, then any other teammate claim on this component
  others.sort((a, b) => Number(disputers.has(b.usn)) - Number(disputers.has(a.usn)))
  const cited = [...claims, ...others].flatMap((c) => c.claim_evidence.filter((e) => e.artifact_id).map((e) => e.artifact_id!))
  const citedVersions = new Set(
    [...claims, ...others].flatMap((c) => c.claim_evidence.filter((e) => e.artifact_id).map((e) => `${e.artifact_id}@v${e.version_no}`)),
  )
  const versions = useArtifactVersions(cited)

  return (
    <section className="space-y-3 rounded-xl bg-contested-soft/40 p-4 ring-1 ring-contested/20" aria-label="The other side of the dispute">
      <div>
        <h3 className="text-sm font-semibold">The other side</h3>
        <p className="text-xs text-muted-foreground">
          Teammates&apos; own claims on {componentLabel(m.milestone_no)}, and every version of the artifacts cited.
        </p>
      </div>
      {all.isPending ? (
        <PanelSkeleton lines={2} />
      ) : all.isError ? (
        <ErrorState error={all.error} onRetry={() => void all.refetch()} compact />
      ) : others.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The disputing teammate has not filed a claim of their own for {componentLabel(m.milestone_no)}.
        </p>
      ) : (
        <ol className="space-y-3">
          {others.map((c) => (
            <li key={c.claim_id} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {c.claimant?.name ?? c.usn}
                {disputers.has(c.usn) ? ' (disputed this claim)' : ''}
              </p>
              <ol>
                <ClaimCard claim={c} highlighted={false} />
              </ol>
            </li>
          ))}
        </ol>
      )}
      {cited.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">Version history of the cited artifacts</h4>
          {versions.isPending ? (
            <PanelSkeleton lines={1} />
          ) : versions.isError ? (
            <ErrorState error={versions.error} compact />
          ) : (
            <ul className="space-y-1 text-sm">
              {(versions.data ?? []).map((v) => {
                const key = `${v.artifact_id}@v${v.version_no}`
                return (
                  <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn('font-mono text-xs', citedVersions.has(key) ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      {key}
                    </span>
                    <span>{v.author?.name ?? v.created_by}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(v.created_at)}</span>
                    {citedVersions.has(key) ? <span className="text-xs text-muted-foreground">· cited as evidence</span> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
