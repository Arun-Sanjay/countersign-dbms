/**
 * Form rules (zod) that mirror the database CHECK constraints and RPC input checks
 * (0002 / 0004), so most mistakes are caught before a round trip. The database stays
 * the real guarantee: three layers, zod -> RPC pre-check -> CHECK / trigger.
 */
import { z } from 'zod'

export const CONTRIBUTION_TYPES = ['research', 'design', 'code', 'documentation', 'review'] as const
export const AI_ASSISTANCE = ['none', 'assisted', 'generated'] as const
export const EVIDENCE_KINDS = ['contribution', 'artifact_version', 'commit', 'url', 'file'] as const
export const VERDICTS = ['confirm', 'dispute'] as const
export const VISIBILITY = ['private', 'team', 'submitted'] as const

export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]
export type AiAssistance = (typeof AI_ASSISTANCE)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
export type Verdict = (typeof VERDICTS)[number]
export type Visibility = (typeof VISIBILITY)[number]

/** claim.statement: CHECK (length(btrim(statement)) >= 10), VARCHAR(500) */
export const claimStatement = z
  .string()
  .trim()
  .min(10, 'Describe the work in at least 10 characters.')
  .max(500, 'Keep it under 500 characters.')

/** file_claim(p_project_id, p_milestone_no, p_contribution_type, p_description, p_ai_assistance, p_artifact_id) */
export const fileClaimSchema = z.object({
  milestone_no: z.number({ message: 'Pick a component.' }).int().positive('Pick a component.'),
  contribution_type: z.enum(CONTRIBUTION_TYPES, { message: 'Pick the kind of work.' }),
  statement: claimStatement,
  ai_assistance: z.enum(AI_ASSISTANCE),
  artifact_id: z.string().max(5).optional(),
})
export type FileClaimInput = z.infer<typeof fileClaimSchema>

/** add_claim_evidence(p_claim_id, p_kind, p_ref, p_note): mirrors claim_evidence_ref_format */
export const addEvidenceSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS, { message: 'Pick a kind of evidence.' }),
    ref: z.string().trim().min(1, 'Evidence needs a reference.'),
    note: z.string().trim().max(200, 'Keep the note under 200 characters.').optional(),
  })
  .superRefine((v, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', path: ['ref'], message })
    if (v.kind === 'contribution' && !/^[0-9]{1,9}$/.test(v.ref)) bad('A contribution reference is its numeric id.')
    if (v.kind === 'artifact_version' && !/^[A-Za-z0-9]{1,5}(@v[0-9]{1,6})?$/.test(v.ref))
      bad('Looks like A13@v2 (or A13 for the latest version).')
    if (v.kind === 'commit' && !/^[0-9a-f]{7,40}$/.test(v.ref)) bad('A commit is a 7–40 character hex SHA.')
    if (v.kind === 'url' && !/^https?:\/\/\S+$/i.test(v.ref)) bad('A URL starts with http:// or https://.')
  })
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>

/** countersign_claim: CHECK (verdict = 'confirm' OR comment IS NOT NULL), comment VARCHAR(300) */
export const countersignSchema = z
  .object({
    verdict: z.enum(VERDICTS, { message: 'Confirm or dispute.' }),
    comment: z.string().trim().max(300, 'Keep it under 300 characters.').optional(),
  })
  .refine((v) => v.verdict === 'confirm' || (v.comment ?? '').length > 0, {
    path: ['comment'],
    message: 'A dispute needs a comment saying what is wrong.',
  })
export type CountersignInput = z.infer<typeof countersignSchema>

/** record_assessment: marks >= 0, one decimal (NUMERIC(4,1)), <= milestone.max_marks (trigger) */
export function marksSchema(maxMarks: number) {
  return z.object({
    marks: z
      .number({ message: 'Enter a number.' })
      .min(0, 'Marks cannot be negative.')
      .max(maxMarks, `The maximum for this component is ${maxMarks}.`)
      .refine((n) => Math.round(n * 10) === n * 10, 'Use at most one decimal place.'),
    remarks: z.string().trim().max(200, 'Keep remarks under 200 characters.').optional(),
  })
}

/** save_private_note: title 1–120 characters */
export const noteSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(120, 'Keep the title under 120 characters.'),
  body: z.string(),
  team_id: z.string().optional(),
})
export type NoteInput = z.infer<typeof noteSchema>

/** submit_milestone: at least one artifact */
export const submitSchema = z.object({
  milestone_no: z.number().int().positive(),
  artifact_ids: z.array(z.string()).min(1, 'Choose at least one artifact to submit.'),
})
export type SubmitInput = z.infer<typeof submitSchema>
