import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Plus } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { SqlButton } from '@/components/sql/SqlButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAddEvidence, type ArtifactRow, type ContributionRow } from '@/data/projects'
import { applyServerError, toastSuccess } from '@/lib/notify'
import { addEvidenceSchema, EVIDENCE_KINDS, type AddEvidenceInput, type EvidenceKind } from '@/lib/rules'
import { EVIDENCE_HINT, EVIDENCE_LABEL } from '../parts/labels'

export interface EvidenceOptions {
  /** The caller's own contributions in this team (a claim may cite only these). */
  contributions: ContributionRow[]
  /** The team's visible artifacts with their versions. */
  artifacts: ArtifactRow[]
}

export function EvidenceKindSelect({
  value,
  onChange,
  id,
  ...aria
}: {
  value: EvidenceKind
  onChange: (k: EvidenceKind) => void
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EvidenceKind)}>
      <SelectTrigger id={id} className="w-full" {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EVIDENCE_KINDS.map((k) => (
          <SelectItem key={k} value={k}>
            {EVIDENCE_LABEL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The reference control adapts to the kind: pickers for rows we hold, free text otherwise. */
export function EvidenceRefInput({
  kind,
  value,
  onChange,
  options,
  id,
  ...aria
}: {
  kind: EvidenceKind
  value: string
  onChange: (v: string) => void
  options: EvidenceOptions
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  if (kind === 'contribution') {
    return (
      <Select value={value ?? ''} onValueChange={onChange} disabled={options.contributions.length === 0}>
        <SelectTrigger id={id} className="w-full" {...aria}>
          <SelectValue placeholder={options.contributions.length ? 'Pick a contribution' : 'You have no contributions here yet'} />
        </SelectTrigger>
        <SelectContent>
          {options.contributions.map((k) => (
            <SelectItem key={k.contribution_id} value={String(k.contribution_id)}>
              <span className="font-mono text-xs text-muted-foreground">#{k.contribution_id}</span>
              <span className="truncate">
                {k.contribution_type} on {k.artifact_title}
                {k.description ? ` — ${k.description}` : ''}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (kind === 'artifact_version') {
    const versions = options.artifacts.flatMap((a) =>
      a.versions.map((v) => ({ ref: `${a.artifact_id}@v${v.version_no}`, title: a.title, latest: v === a.latest })),
    )
    return (
      <Select value={value ?? ''} onValueChange={onChange} disabled={versions.length === 0}>
        <SelectTrigger id={id} className="w-full" {...aria}>
          <SelectValue placeholder={versions.length ? 'Pick an artifact version' : 'No saved versions yet'} />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.ref} value={v.ref}>
              <span className="font-mono text-xs">{v.ref}</span>
              <span className="truncate text-muted-foreground">
                {v.title}
                {v.latest ? ' · latest' : ''}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      id={id}
      {...aria}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={kind === 'commit' ? '3f9c2ab' : kind === 'url' ? 'https://…' : 'path/to/file.sql'}
      className={kind === 'url' ? undefined : 'font-mono'}
      autoComplete="off"
      spellCheck={false}
    />
  )
}

/** add_claim_evidence on one of my pending claims. */
export function AddEvidenceForm({
  projectId,
  claimId,
  options,
  onDone,
}: {
  projectId: string
  claimId: number
  options: EvidenceOptions
  onDone?: () => void
}) {
  const add = useAddEvidence(projectId)
  const form = useForm<AddEvidenceInput>({
    resolver: zodResolver(addEvidenceSchema),
    defaultValues: { kind: 'url', ref: '', note: '' },
  })
  const kind = useWatch({ control: form.control, name: 'kind' })

  const submit = form.handleSubmit((v) =>
    add.mutateAsync({ claimId, kind: v.kind, ref: v.ref, note: v.note || undefined }).then(
      (r) => {
        toastSuccess(`Evidence #${r.evidence_no} attached`, 'The claim revision went up: teammates sign the new revision.')
        form.reset({ kind: v.kind, ref: '', note: '' })
        onDone?.()
      },
      (e) => {
        applyServerError(e, form.setError, ['kind', 'ref', 'note'])
      },
    ),
  )

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-muted/40 p-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Controller
          control={form.control}
          name="kind"
          render={({ field, fieldState }) => (
            <FormField label="Kind" error={fieldState.error}>
              <EvidenceKindSelect
                value={field.value}
                onChange={(k) => {
                  field.onChange(k)
                  form.setValue('ref', '')
                  form.clearErrors('ref')
                }}
              />
            </FormField>
          )}
        />
        <Controller
          control={form.control}
          name="ref"
          render={({ field, fieldState }) => (
            <FormField label="Reference" error={fieldState.error} hint={EVIDENCE_HINT[kind]}>
              <EvidenceRefInput kind={kind} value={field.value} onChange={field.onChange} options={options} />
            </FormField>
          )}
        />
      </div>
      <FormField label="Note" error={form.formState.errors.note} hint="Optional: which part of it was yours.">
        <Input {...form.register('note')} placeholder="e.g. sections 2 and 3" />
      </FormField>
      <div className="flex items-center justify-end gap-2">
        <SqlButton panelId="project.add_evidence" />
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Attach evidence
        </Button>
      </div>
    </form>
  )
}
