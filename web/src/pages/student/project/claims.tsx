import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Loader2, Plus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { StatusBadge } from '@/components/StatusBadge'
import { SqlButton } from '@/components/sql/SqlButton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useCountersign, type ClaimRow } from '@/data/projects'
import { componentLabel, formatDateTime, initials } from '@/lib/format'
import { applyServerError, toastError, toastSuccess } from '@/lib/notify'
import { countersignSchema, type CountersignInput } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { CONTRIBUTION_LABEL } from '../parts/labels'
import { AiBadge, CountersignList, EvidenceList, type EvidenceLookups } from '../parts/ui'
import { AddEvidenceForm, type EvidenceOptions } from './evidence'

function ClaimMeta({ claim, componentTitle }: { claim: ClaimRow; componentTitle?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-mono text-foreground">{componentLabel(claim.milestone_no)}</span>
      {componentTitle ? <span>{componentTitle}</span> : null}
      <span aria-hidden>·</span>
      <span>claim #{claim.claim_id}</span>
      <span aria-hidden>·</span>
      <span title="Bumped whenever the text or the evidence list changes">revision {claim.revision}</span>
      <span aria-hidden>·</span>
      <span>{formatDateTime(claim.created_at)}</span>
    </div>
  )
}

/** One of my claims: statement, evidence, countersigns; evidence adder while pending. */
export function MyClaimCard({
  claim,
  projectId,
  componentTitle,
  locked,
  options,
  lookups,
}: {
  claim: ClaimRow
  projectId: string
  componentTitle?: string
  locked: boolean
  options: EvidenceOptions
  lookups: EvidenceLookups
}) {
  const [adding, setAdding] = useState(false)
  const canAdd = claim.status === 'pending' && !locked
  return (
    <article data-claim={claim.claim_id} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ClaimMeta claim={claim} componentTitle={componentTitle} />
        <div className="flex flex-wrap items-center gap-1.5">
          {claim.contribution_type ? <Badge variant="outline">{CONTRIBUTION_LABEL[claim.contribution_type]}</Badge> : null}
          <AiBadge value={claim.ai_assistance} />
          <StatusBadge status={claim.status} />
        </div>
      </div>
      <p className="text-sm leading-relaxed">{claim.statement}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Evidence ({claim.evidence.length})</p>
          <EvidenceList evidence={claim.evidence} lookups={lookups} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Countersigns</p>
          <CountersignList countersigns={claim.countersigns} currentRevision={claim.revision} />
        </div>
      </div>
      {canAdd ? (
        <Collapsible open={adding} onOpenChange={setAdding}>
          <CollapsibleTrigger asChild>
            <Button size="xs" variant="ghost" className="text-brand">
              <Plus /> Add evidence
              <ChevronDown className={cn('transition-transform', adding && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <AddEvidenceForm projectId={projectId} claimId={claim.claim_id} options={options} onDone={() => setAdding(false)} />
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p className="text-xs text-muted-foreground">
          {locked
            ? 'This component is locked: the claim and its evidence are final.'
            : 'A teammate has countersigned this claim, so its text and evidence are frozen.'}
        </p>
      )}
    </article>
  )
}

/** A teammate's pending claim: confirm or dispute the exact revision shown. */
export function QueueCard({
  claim,
  projectId,
  componentTitle,
  lookups,
}: {
  claim: ClaimRow
  projectId: string
  componentTitle?: string
  lookups: EvidenceLookups
}) {
  const countersign = useCountersign(projectId)
  const [disputeOpen, setDisputeOpen] = useState(false)

  const confirm = () =>
    countersign
      .mutateAsync({ claimId: claim.claim_id, verdict: 'confirm', revision: claim.revision })
      .then((r) => toastSuccess(`Confirmed claim #${claim.claim_id}`, `${claim.claimant}'s claim is now ${r.claim_status}.`))
      .catch((e) => {
        toastError(e)
        throw e
      })

  return (
    <article data-claim={claim.claim_id} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className="text-[10px]">{initials(claim.claimant)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">{claim.claimant}</p>
            <ClaimMeta claim={claim} componentTitle={componentTitle} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {claim.contribution_type ? <Badge variant="outline">{CONTRIBUTION_LABEL[claim.contribution_type]}</Badge> : null}
          <AiBadge value={claim.ai_assistance} />
          <StatusBadge status={claim.status} />
        </div>
      </div>
      <blockquote className="border-l-2 border-brand/40 pl-3 text-sm leading-relaxed">{claim.statement}</blockquote>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Evidence ({claim.evidence.length})</p>
        <EvidenceList evidence={claim.evidence} lookups={lookups} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          You are signing <span className="font-medium text-foreground">revision {claim.revision}</span>. If it changes before you sign, the
          database refuses the signature.
        </p>
        <div className="flex items-center gap-2">
          <SqlButton panelId="project.countersign" />
          <Button size="sm" variant="outline" onClick={() => setDisputeOpen(true)}>
            <ThumbsDown /> Dispute
          </Button>
          <ConfirmDialog
            title={`Confirm ${claim.claimant}'s claim?`}
            description={`You confirm that this statement and its ${claim.evidence.length} piece(s) of evidence, at revision ${claim.revision}, match what ${claim.claimant} did.`}
            confirmLabel="Confirm claim"
            onConfirm={confirm}
            trigger={
              <Button size="sm">
                <ThumbsUp /> Confirm
              </Button>
            }
          />
        </div>
      </div>
      <DisputeDialog open={disputeOpen} onOpenChange={setDisputeOpen} claim={claim} projectId={projectId} />
    </article>
  )
}

function DisputeDialog({
  open,
  onOpenChange,
  claim,
  projectId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  claim: ClaimRow
  projectId: string
}) {
  const countersign = useCountersign(projectId)
  const form = useForm<CountersignInput>({
    resolver: zodResolver(countersignSchema),
    defaultValues: { verdict: 'dispute', comment: '' },
  })
  const comment = useWatch({ control: form.control, name: 'comment' }) ?? ''

  const submit = form.handleSubmit((v) =>
    countersign
      .mutateAsync({ claimId: claim.claim_id, verdict: 'dispute', comment: v.comment, revision: claim.revision })
      .then(
        (r) => {
          toastSuccess(`Disputed claim #${claim.claim_id}`, `It is now ${r.claim_status}: it goes to the faculty review queue.`)
          form.reset({ verdict: 'dispute', comment: '' })
          onOpenChange(false)
        },
        (e) => {
          applyServerError(e, form.setError, ['comment', 'verdict'])
        },
      ),
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !countersign.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispute {claim.claimant}&apos;s claim</DialogTitle>
          <DialogDescription>
            A dispute marks the claim as contested and sends it to the faculty review queue. Say what is wrong: the database
            refuses a dispute without a comment.
          </DialogDescription>
        </DialogHeader>
        <form id={`dispute-${claim.claim_id}`} onSubmit={submit} noValidate className="space-y-3">
          <blockquote className="border-l-2 border-contested/40 pl-3 text-sm text-muted-foreground">{claim.statement}</blockquote>
          <FormField
            label="What is wrong?"
            required
            error={form.formState.errors.comment}
            aside={<span className="tabular">{comment.trim().length} / 300</span>}
          >
            <Textarea rows={3} placeholder="I wrote the literature survey (see version 2)." {...form.register('comment')} />
          </FormField>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <SqlButton panelId="project.countersign" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={countersign.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={`dispute-${claim.claim_id}`} variant="destructive" disabled={countersign.isPending}>
              {countersign.isPending ? <Loader2 className="animate-spin" /> : <ThumbsDown />}
              Dispute claim
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A teammate's claim I already signed (compact). */
export function SignedRow({ claim, myUsn, componentTitle }: { claim: ClaimRow; myUsn: string; componentTitle?: string }) {
  const mine = claim.countersigns.find((s) => s.endorser_usn === myUsn)
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate">
          <span className="font-medium">{claim.claimant}</span>{' '}
          <span className="text-muted-foreground">
            · <span className="font-mono">{componentLabel(claim.milestone_no)}</span> {componentTitle}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">{claim.statement}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {mine ? (
          <Badge variant={mine.verdict === 'confirm' ? 'secondary' : 'destructive'}>
            You {mine.verdict === 'confirm' ? 'confirmed' : 'disputed'} r{mine.claim_revision}
          </Badge>
        ) : null}
        <StatusBadge status={claim.status} />
      </div>
    </li>
  )
}
