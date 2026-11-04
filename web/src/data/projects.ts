/**
 * Project page data: components (v_rubric_sheet), artifacts + versions, my claims with
 * evidence and countersigns, the countersign queue, submissions, contributions; and the
 * write paths file_claim, add_claim_evidence, countersign_claim, submit_milestone.
 * Reads go through RLS as the signed-in student; writes are SECURITY INVOKER RPCs, so the
 * 0002 integrity triggers still decide.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '@/data/keys'
import { rpc } from '@/data/rpc'
import type {
  AddEvidenceResult,
  ClaimStatus,
  CountersignResult,
  FileClaimResult,
  SubmitMilestoneResult,
} from '@/data/types'
import { throwIfError } from '@/lib/errors'
import type { AiAssistance, ContributionType, EvidenceKind, Verdict, Visibility } from '@/lib/rules'
import { supabase } from '@/lib/supabase'

export const projectKeys = {
  info: (projectId: string) => [...keys.project.one(projectId), 'info'] as const,
  myTeam: (projectId: string, usn: string) => [...keys.project.one(projectId), 'my-team', usn] as const,
  components: (projectId: string, usn: string) => [...keys.project.one(projectId), 'components', usn] as const,
  submissions: (projectId: string, teamId: string) => [...keys.project.one(projectId), 'submissions', teamId] as const,
  artifacts: (projectId: string, teamId: string) => [...keys.project.one(projectId), 'artifacts', teamId] as const,
  claims: (projectId: string, teamId: string) => [...keys.project.one(projectId), 'claims', teamId] as const,
  contributions: (projectId: string, teamId: string) => [...keys.project.one(projectId), 'contributions', teamId] as const,
}

// ---- project + my team ----------------------------------------------------------------------
export interface ProjectInfo {
  project_id: string
  title: string
  description: string | null
  status: string
  course_code: string
  course_title: string | null
  start_date: string
  end_date: string
}

export function useProjectInfo(projectId: string) {
  return useQuery({
    queryKey: projectKeys.info(projectId),
    queryFn: async (): Promise<ProjectInfo | null> => {
      const { data, error } = await supabase
        .from('project')
        .select('project_id, title, description, status, course_code, start_date, end_date, course(title)')
        .eq('project_id', projectId)
        .maybeSingle()
      throwIfError(error)
      if (!data) return null
      return { ...data, course_title: data.course?.title ?? null }
    },
  })
}

export interface MyTeam {
  team_id: string
  team_name: string
  role: 'lead' | 'member'
  max_size: number
  topic_title: string | null
  members: { usn: string; name: string; role: 'lead' | 'member' }[]
}

/** The caller's team in this project (one team per project: a trigger rule). */
export function useMyTeam(projectId: string, usn: string | null) {
  return useQuery({
    queryKey: projectKeys.myTeam(projectId, usn ?? ''),
    enabled: Boolean(usn),
    queryFn: async (): Promise<MyTeam | null> => {
      const { data, error } = await supabase
        .from('team_member')
        .select('team_id, role, team!inner(team_name, project_id, max_size, topic_title, team_member(usn, role, student(name)))')
        .eq('usn', usn!)
        .eq('team.project_id', projectId)
        .maybeSingle()
      throwIfError(error)
      if (!data?.team) return null
      const t = data.team
      return {
        team_id: data.team_id,
        team_name: t.team_name,
        role: data.role as 'lead' | 'member',
        max_size: t.max_size,
        topic_title: t.topic_title,
        members: (t.team_member ?? [])
          .map((m) => ({ usn: m.usn, name: m.student?.name ?? m.usn, role: m.role as 'lead' | 'member' }))
          .sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || a.name.localeCompare(b.name)),
      }
    },
  })
}

// ---- components (v_rubric_sheet, my own row per component) -----------------------------------
export interface ComponentRow {
  milestone_no: number
  component: string
  max_marks: number
  deadline: string
  counts_in_reduced: boolean
  locked: boolean
  /** NULL when unassessed (RLS shows a student only their own marks). */
  marks: number | null
  claims_pending: number
  claims_confirmed: number
  claims_contested: number
}

export function useComponents(projectId: string, usn: string | null) {
  return useQuery({
    queryKey: projectKeys.components(projectId, usn ?? ''),
    enabled: Boolean(usn),
    queryFn: async (): Promise<ComponentRow[]> => {
      const { data, error } = await supabase
        .from('v_rubric_sheet')
        .select(
          'milestone_no, component, max_marks, deadline, counts_in_reduced, locked, marks, claims_pending, claims_confirmed, claims_contested',
        )
        .eq('project_id', projectId)
        .eq('usn', usn!)
        .order('milestone_no')
      throwIfError(error)
      return (data ?? []).map((r) => ({
        milestone_no: r.milestone_no ?? 0,
        component: r.component ?? '',
        max_marks: r.max_marks ?? 0,
        deadline: r.deadline ?? '',
        counts_in_reduced: Boolean(r.counts_in_reduced),
        locked: Boolean(r.locked),
        marks: r.marks,
        claims_pending: r.claims_pending ?? 0,
        claims_confirmed: r.claims_confirmed ?? 0,
        claims_contested: r.claims_contested ?? 0,
      }))
    },
  })
}

// ---- submissions -------------------------------------------------------------------------------
export interface SubmissionRow {
  submission_id: number
  milestone_no: number
  attempt_no: number
  submitted_by: string
  submitted_at: string
  artifacts: { artifact_id: string; version_no: number }[]
}

export function useSubmissions(projectId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.submissions(projectId, teamId ?? ''),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SubmissionRow[]> => {
      const { data, error } = await supabase
        .from('submission')
        .select('submission_id, milestone_no, attempt_no, submitted_by, submitted_at, submission_artifact(artifact_id, version_no)')
        .eq('team_id', teamId!)
        .order('milestone_no')
        .order('attempt_no')
      throwIfError(error)
      return (data ?? []).map((s) => ({ ...s, artifacts: s.submission_artifact ?? [] }))
    },
  })
}

// ---- artifacts + versions ------------------------------------------------------------------------
export interface ArtifactVersionRow {
  version_no: number
  created_by: string
  created_at: string
  ai_assistance: AiAssistance
}
export interface ArtifactRow {
  artifact_id: string
  milestone_no: number
  title: string
  type: string
  source: string
  visibility: Visibility
  owner_usn: string | null
  external_ref: string | null
  created_at: string
  versions: ArtifactVersionRow[]
  latest: ArtifactVersionRow | null
}

export function useArtifacts(projectId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.artifacts(projectId, teamId ?? ''),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ArtifactRow[]> => {
      const { data, error } = await supabase
        .from('artifact')
        .select(
          'artifact_id, milestone_no, title, type, source, visibility, owner_usn, external_ref, created_at, artifact_version(version_no, created_by, created_at, ai_assistance)',
        )
        .eq('team_id', teamId!)
        .order('milestone_no')
        .order('artifact_id')
      throwIfError(error)
      return (data ?? []).map((a) => {
        const versions = [...(a.artifact_version ?? [])]
          .sort((x, y) => x.version_no - y.version_no)
          .map((v) => ({ ...v, ai_assistance: v.ai_assistance as AiAssistance }))
        return {
          artifact_id: a.artifact_id,
          milestone_no: a.milestone_no,
          title: a.title,
          type: a.type,
          source: a.source,
          visibility: a.visibility as Visibility,
          owner_usn: a.owner_usn,
          external_ref: a.external_ref,
          created_at: a.created_at,
          versions,
          latest: versions[versions.length - 1] ?? null,
        }
      })
    },
  })
}

// ---- claims (mine and my teammates') -----------------------------------------------------------
export interface EvidenceRow {
  evidence_no: number
  kind: EvidenceKind
  contribution_id: number | null
  artifact_id: string | null
  version_no: number | null
  ref: string | null
  note: string | null
  added_at: string
}
export interface CountersignRow {
  endorser_usn: string
  endorser_name: string
  verdict: Verdict
  comment: string | null
  claim_revision: number
  signed_at: string
}
export interface ClaimRow {
  claim_id: number
  usn: string
  claimant: string
  team_id: string
  milestone_no: number
  statement: string
  contribution_type: ContributionType | null
  ai_assistance: AiAssistance
  status: ClaimStatus
  revision: number
  created_at: string
  evidence: EvidenceRow[]
  countersigns: CountersignRow[]
}

/** Every claim of my team in this project (RLS: claim_select = team members or staff). */
export function useTeamClaims(projectId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.claims(projectId, teamId ?? ''),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ClaimRow[]> => {
      const { data, error } = await supabase
        .from('claim')
        .select(
          'claim_id, usn, team_id, milestone_no, statement, contribution_type, ai_assistance, status, revision, created_at, student!claim_usn_fkey(name), claim_evidence(evidence_no, kind, contribution_id, artifact_id, version_no, ref, note, added_at), countersign(endorser_usn, verdict, comment, claim_revision, signed_at, student!countersign_endorser_usn_fkey(name))',
        )
        .eq('project_id', projectId)
        .eq('team_id', teamId!)
        .order('milestone_no')
        .order('created_at')
      throwIfError(error)
      return (data ?? []).map((c) => ({
        claim_id: c.claim_id,
        usn: c.usn,
        claimant: c.student?.name ?? c.usn,
        team_id: c.team_id,
        milestone_no: c.milestone_no,
        statement: c.statement,
        contribution_type: c.contribution_type as ContributionType | null,
        ai_assistance: c.ai_assistance as AiAssistance,
        status: c.status as ClaimStatus,
        revision: c.revision,
        created_at: c.created_at,
        evidence: [...(c.claim_evidence ?? [])]
          .sort((a, b) => a.evidence_no - b.evidence_no)
          .map((e) => ({ ...e, kind: e.kind as EvidenceKind })),
        countersigns: (c.countersign ?? []).map((s) => ({
          endorser_usn: s.endorser_usn,
          endorser_name: s.student?.name ?? s.endorser_usn,
          verdict: s.verdict as Verdict,
          comment: s.comment,
          claim_revision: s.claim_revision,
          signed_at: s.signed_at,
        })),
      }))
    },
  })
}

// ---- contributions (who built what; evidence picker) ---------------------------------------------
export interface ContributionRow {
  contribution_id: number
  usn: string
  name: string
  artifact_id: string
  artifact_title: string
  milestone_no: number
  contribution_type: string
  description: string | null
  source: string
  source_ref: string | null
  at: string
  ai_assisted: boolean
}

export function useTeamContributions(projectId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.contributions(projectId, teamId ?? ''),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ContributionRow[]> => {
      const { data, error } = await supabase
        .from('contribution')
        .select(
          'contribution_id, usn, contribution_type, description, source, source_ref, created_at, occurred_at, ai_assisted, student!contribution_usn_fkey(name), artifact!contribution_artifact_id_fkey!inner(artifact_id, title, team_id, milestone_no)',
        )
        .eq('artifact.team_id', teamId!)
        .order('contribution_id', { ascending: false })
      throwIfError(error)
      return (data ?? [])
        .map((k) => ({
          contribution_id: k.contribution_id,
          usn: k.usn,
          name: k.student?.name ?? k.usn,
          artifact_id: k.artifact.artifact_id,
          artifact_title: k.artifact.title,
          milestone_no: k.artifact.milestone_no,
          contribution_type: k.contribution_type,
          description: k.description,
          source: k.source,
          source_ref: k.source_ref,
          at: k.occurred_at ?? k.created_at,
          ai_assisted: k.ai_assisted,
        }))
        .sort((a, b) => b.at.localeCompare(a.at))
    },
  })
}

// ---- writes ---------------------------------------------------------------------------------------
function useInvalidateProject(projectId: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.project.one(projectId) }),
      qc.invalidateQueries({ queryKey: keys.hub.all }),
      qc.invalidateQueries({ queryKey: keys.facultyView.all }),
    ])
}

export interface EvidenceInput {
  kind: EvidenceKind
  ref: string
  note?: string
}

export interface FileClaimInputFull {
  milestoneNo: number
  contributionType: ContributionType
  statement: string
  aiAssistance: AiAssistance
  artifactId?: string
  evidence: EvidenceInput[]
}

/** Thrown when the claim was filed but one of the extra evidence rows was refused. */
export class EvidenceAfterClaimError extends Error {
  readonly claimId: number
  readonly index: number
  readonly reason: unknown
  constructor(claimId: number, index: number, reason: unknown) {
    super(`Claim #${claimId} was filed, but evidence ${index + 1} was refused.`)
    this.name = 'EvidenceAfterClaimError'
    this.claimId = claimId
    this.index = index
    this.reason = reason
  }
}

/**
 * file_claim (one transaction: the claim + the cited artifact's latest version as
 * evidence #1), then add_claim_evidence once per extra evidence row.
 */
export function useFileClaim(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: async (input: FileClaimInputFull) => {
      const res = await rpc<FileClaimResult>('file_claim', {
        p_project_id: projectId,
        p_milestone_no: input.milestoneNo,
        p_contribution_type: input.contributionType,
        p_description: input.statement,
        p_ai_assistance: input.aiAssistance,
        ...(input.artifactId ? { p_artifact_id: input.artifactId } : {}),
      })
      for (const [i, ev] of input.evidence.entries()) {
        try {
          await rpc<AddEvidenceResult>('add_claim_evidence', {
            p_claim_id: res.claim_id,
            p_kind: ev.kind,
            p_ref: ev.ref,
            ...(ev.note ? { p_note: ev.note } : {}),
          })
        } catch (e) {
          throw new EvidenceAfterClaimError(res.claim_id, i, e)
        }
      }
      return res
    },
    onSettled: () => invalidate(),
  })
}

export function useAddEvidence(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: (args: { claimId: number } & EvidenceInput) =>
      rpc<AddEvidenceResult>('add_claim_evidence', {
        p_claim_id: args.claimId,
        p_kind: args.kind,
        p_ref: args.ref,
        ...(args.note ? { p_note: args.note } : {}),
      }),
    onSuccess: () => invalidate(),
  })
}

/** countersign_claim: passes the revision the UI showed (optimistic concurrency). */
export function useCountersign(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: (args: { claimId: number; verdict: Verdict; comment?: string; revision: number }) =>
      rpc<CountersignResult>('countersign_claim', {
        p_claim_id: args.claimId,
        p_verdict: args.verdict,
        p_claim_revision: args.revision,
        ...(args.comment ? { p_comment: args.comment } : {}),
      }),
    onSettled: () => invalidate(),
  })
}

export function useSubmitMilestone(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: (args: { teamId: string; milestoneNo: number; artifactIds: string[] }) =>
      rpc<SubmitMilestoneResult>('submit_milestone', {
        p_team_id: args.teamId,
        p_milestone_no: args.milestoneNo,
        p_artifact_ids: args.artifactIds,
      }),
    onSuccess: () => invalidate(),
  })
}
