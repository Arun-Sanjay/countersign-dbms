import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { FormField } from '@/components/FormField'
import { SqlButton } from '@/components/sql/SqlButton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EvidenceAfterClaimError, useFileClaim, type ComponentRow } from '@/data/projects'
import { AppErrorException, toAppError } from '@/lib/errors'
import { componentLabel } from '@/lib/format'
import { applyServerError, toastError, toastSuccess } from '@/lib/notify'
import { addEvidenceSchema, AI_ASSISTANCE, CONTRIBUTION_TYPES, fileClaimSchema } from '@/lib/rules'
import { AI_OPTION, CONTRIBUTION_LABEL, EVIDENCE_HINT } from '../parts/labels'
import { EvidenceKindSelect, EvidenceRefInput, type EvidenceOptions } from './evidence'

const NO_ARTIFACT = '__none__'

const schema = fileClaimSchema
  .extend({
    evidence: z.array(addEvidenceSchema).max(10, 'Attach at most 10 items here; add more later.'),
  })
  // every claim needs a receipt: a cited artifact or at least one evidence row
  .refine((v) => (v.artifact_id && v.artifact_id !== NO_ARTIFACT) || v.evidence.length > 0, {
    path: ['evidence'],
    message: 'Attach at least one receipt: cite an artifact above, or add a piece of evidence here.',
  })
type Values = z.input<typeof schema>

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  components: ComponentRow[]
  /** Component to preselect (from a row's "Claim" button). */
  initialMilestone?: number
  options: EvidenceOptions
  /** My team has one member: no teammate can countersign, so the claim rests on its evidence. */
  solo?: boolean
}

/** "I did X for component C": file_claim + evidence, with AI assistance declared. */
export function FileClaimDialog({ projectId, open, onOpenChange, components, initialMilestone, options, solo = false }: Props) {
  const fileClaim = useFileClaim(projectId)
  const openComponents = components.filter((c) => !c.locked)
  const defaultMilestone = initialMilestone ?? openComponents[0]?.milestone_no

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      milestone_no: defaultMilestone ?? 0,
      contribution_type: 'documentation',
      statement: '',
      ai_assistance: 'none',
      artifact_id: undefined,
      evidence: [],
    },
  })
  const evidence = useFieldArray({ control: form.control, name: 'evidence' })

  // re-seed when opened for a specific component
  useEffect(() => {
    if (open) {
      form.reset({
        milestone_no: defaultMilestone ?? 0,
        contribution_type: 'documentation',
        statement: '',
        ai_assistance: 'none',
        artifact_id: undefined,
        evidence: [],
      })
    }
  }, [open, defaultMilestone, form])

  const milestone = useWatch({ control: form.control, name: 'milestone_no' })
  const statement = useWatch({ control: form.control, name: 'statement' }) ?? ''
  const ai = useWatch({ control: form.control, name: 'ai_assistance' }) ?? 'none'
  const evidenceValues = useWatch({ control: form.control, name: 'evidence' })
  const citeable = options.artifacts.filter((a) => a.milestone_no === milestone && a.latest)
  const evErrors = form.formState.errors.evidence as { message?: string; root?: { message?: string } } | undefined
  const evidenceError = evErrors?.root?.message ?? evErrors?.message

  const submit = form.handleSubmit(async (v) => {
    try {
      const res = await fileClaim.mutateAsync({
        milestoneNo: v.milestone_no,
        contributionType: v.contribution_type,
        statement: v.statement,
        aiAssistance: v.ai_assistance ?? 'none',
        artifactId: v.artifact_id && v.artifact_id !== NO_ARTIFACT ? v.artifact_id : undefined,
        evidence: v.evidence.map((e) => ({ kind: e.kind, ref: e.ref, note: e.note || undefined })),
      })
      const n = res.evidence.length + v.evidence.length
      toastSuccess(
        `Claim #${res.claim_id} filed for ${componentLabel(v.milestone_no)}`,
        solo
          ? `${n} piece${n === 1 ? '' : 's'} of evidence attached. Solo team: no teammate to countersign, so it rests on its evidence and faculty review.`
          : `${n} piece${n === 1 ? '' : 's'} of evidence attached. It is pending until a teammate countersigns it.`,
      )
      onOpenChange(false)
    } catch (e) {
      if (e instanceof EvidenceAfterClaimError) {
        // the claim exists: close, and say exactly which evidence row the database refused
        const err = toAppError(e.reason)
        toastError(new AppErrorException({ ...err, title: `Claim #${e.claimId} filed, evidence ${e.index + 1} refused` }))
        onOpenChange(false)
        return
      }
      applyServerError(e, form.setError, ['milestone_no', 'contribution_type', 'statement', 'ai_assistance', 'artifact_id'])
    }
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !fileClaim.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>File a claim</DialogTitle>
          <DialogDescription>
            Say what you did for one component and back it with evidence. A teammate then confirms or disputes it. Declare AI
            assistance honestly: it is never detected, and never shown to faculty next to viva scores.
          </DialogDescription>
        </DialogHeader>

        <form id="file-claim" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="milestone_no"
              render={({ field, fieldState }) => (
                <FormField label="Component" required error={fieldState.error}>
                  <Select
                    value={field.value ? String(field.value) : ''}
                    onValueChange={(v) => {
                      field.onChange(Number(v))
                      form.setValue('artifact_id', undefined)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a component" />
                    </SelectTrigger>
                    <SelectContent>
                      {components.map((c) => (
                        <SelectItem key={c.milestone_no} value={String(c.milestone_no)} disabled={c.locked}>
                          <span className="font-mono text-xs">{componentLabel(c.milestone_no)}</span> {c.component}
                          {c.locked ? <span className="text-xs text-muted-foreground"> · locked</span> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={form.control}
              name="contribution_type"
              render={({ field, fieldState }) => (
                <FormField label="Kind of work" required error={fieldState.error}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRIBUTION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {CONTRIBUTION_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          </div>

          <FormField
            label="What did you do?"
            required
            error={form.formState.errors.statement}
            aside={<span className="tabular">{statement.trim().length} / 500</span>}
            hint="At least 10 characters. Be specific: which sections, queries or diagrams were yours."
          >
            <Textarea rows={3} placeholder="Wrote the ER diagram v2 in Chen notation, with MILESTONE as a weak entity." {...form.register('statement')} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="ai_assistance"
              render={({ field, fieldState }) => (
                <FormField label="AI assistance" required error={fieldState.error} hint={AI_OPTION[ai].hint}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_ASSISTANCE.map((a) => (
                        <SelectItem key={a} value={a}>
                          {AI_OPTION[a].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={form.control}
              name="artifact_id"
              render={({ field, fieldState }) => (
                <FormField
                  label="Cite an artifact"
                  error={fieldState.error}
                  hint="Its latest version becomes evidence #1, in the same transaction."
                >
                  <Select value={field.value ?? NO_ARTIFACT} onValueChange={(v) => field.onChange(v === NO_ARTIFACT ? undefined : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ARTIFACT}>None</SelectItem>
                      {citeable.map((a) => (
                        <SelectItem key={a.artifact_id} value={a.artifact_id}>
                          <span className="font-mono text-xs">{a.artifact_id}</span> {a.title}
                          <span className="text-xs text-muted-foreground"> · v{a.latest?.version_no}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          </div>

          {/* ---------- evidence adder ---------- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Evidence <span className="font-normal text-muted-foreground">(at least one receipt, counting a cited artifact)</span>
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => evidence.append({ kind: 'url', ref: '', note: '' })}
                disabled={evidence.fields.length >= 10}
              >
                <Plus /> Add evidence
              </Button>
            </div>
            {evidenceError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {evidenceError}
              </p>
            ) : null}
            {evidence.fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Contributions, artifact versions, commits, links or files: each one is a receipt a teammate can check.
              </p>
            ) : (
              <ul className="space-y-2">
                {evidence.fields.map((f, i) => {
                  const kind = evidenceValues?.[i]?.kind ?? f.kind
                  return (
                    <li key={f.id} className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[9rem_1fr_auto]">
                      <Controller
                        control={form.control}
                        name={`evidence.${i}.kind`}
                        render={({ field }) => (
                          <FormField label={`#${i + 1} kind`}>
                            <EvidenceKindSelect
                              value={field.value}
                              onChange={(k) => {
                                field.onChange(k)
                                form.setValue(`evidence.${i}.ref`, '')
                                form.clearErrors(`evidence.${i}.ref`)
                              }}
                            />
                          </FormField>
                        )}
                      />
                      <Controller
                        control={form.control}
                        name={`evidence.${i}.ref`}
                        render={({ field, fieldState }) => (
                          <FormField label="Reference" error={fieldState.error} hint={EVIDENCE_HINT[kind]}>
                            <EvidenceRefInput kind={kind} value={field.value} onChange={field.onChange} options={options} />
                          </FormField>
                        )}
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="mt-6"
                        onClick={() => evidence.remove(i)}
                        aria-label={`Remove evidence ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                      <div className="sm:col-span-3">
                        <Input placeholder="Note (optional)" aria-label={`Evidence ${i + 1} note`} {...form.register(`evidence.${i}.note`)} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </form>

        <DialogFooter className="items-center sm:justify-between">
          <SqlButton panelId="project.file_claim" />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={fileClaim.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="file-claim" disabled={fileClaim.isPending || openComponents.length === 0}>
              {fileClaim.isPending ? <Loader2 className="animate-spin" /> : null}
              File claim
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
