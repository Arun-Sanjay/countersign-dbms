/**
 * Faculty data: v_rubric_sheet, record_assessment, lock_milestone, v_contested_claims,
 * v_faculty_team_progress, v_lab_cie_marks. Owned by the faculty pages.
 *
 * Every read runs as the signed-in user through PostgREST: the views are security_invoker,
 * so RLS decides the rows (a faculty member who does not teach the project gets none).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { keys } from '@/data/keys'
import { rpc } from '@/data/rpc'
import type { ClaimStatus, LockMilestoneResult, RecordAssessmentResult, TableRow, ViewRow } from '@/data/types'
import { throwIfError } from '@/lib/errors'
import type { AiAssistance, ContributionType, EvidenceKind, Verdict, Visibility } from '@/lib/rules'
import { supabase } from '@/lib/supabase'

export type RubricCell = ViewRow<'v_rubric_sheet'>
export type CieRow = ViewRow<'v_lab_cie_marks'>
export type ContestedRow = ViewRow<'v_contested_claims'>
export type TeamProgress = ViewRow<'v_faculty_team_progress'>
export type Milestone = Pick<
  TableRow<'milestone'>,
  'project_id' | 'milestone_no' | 'title' | 'max_marks' | 'deadline' | 'cie_part' | 'locked_at'
>

export const facultyKeys = {
  all: keys.faculty.all,
  projects: (who: string | undefined) => [...keys.faculty.all, 'projects', who] as const,
  project: (projectId: string) => [...keys.faculty.all, 'project', projectId] as const,
  sheet: (projectId: string) => [...keys.faculty.all, 'sheet', projectId] as const,
  milestones: (projectId: string) => [...keys.faculty.all, 'milestones', projectId] as const,
  cie: (projectId: string) => [...keys.faculty.all, 'cie', projectId] as const,
  progress: (projectId: string) => [...keys.faculty.all, 'progress', projectId] as const,
  cellClaims: (usn: string, projectId: string, milestoneNo: number) =>
    [...keys.faculty.all, 'claims', usn, projectId, milestoneNo] as const,
  assessment: (usn: string, projectId: string, milestoneNo: number) =>
    [...keys.faculty.all, 'assessment', usn, projectId, milestoneNo] as const,
  contested: () => [...keys.faculty.all, 'contested'] as const,
  evidence: (projectId: string) => [...keys.faculty.all, 'evidence', projectId] as const,
  signatures: (projectId: string) => [...keys.faculty.all, 'signatures', projectId] as const,
  componentClaims: (teamId: string, projectId: string, milestoneNo: number) =>
    [...keys.faculty.all, 'component-claims', teamId, projectId, milestoneNo] as const,
  versions: (ids: string) => [...keys.faculty.all, 'versions', ids] as const,
}

// ---- projects I teach (faculty landing) ---------------------------------------------------

export interface TaughtProject {
  projectId: string
  title: string
  description: string | null
  status: string
  courseCode: string
  courseTitle: string
  startDate: string
  endDate: string
  /** null for the fixture projects (no course offering: course.faculty_id decides) */
  offering: { termId: string; section: string } | null
  /** has an Innovative/Final component, so it is on the lab CIE (/50) */
  isLab: boolean
  /** rolled up from v_faculty_team_progress (metadata only); 0 when no team yet */
  teams: number
  students: number
  claimsPending: number
  claimsContested: number
  lastActivity: string | null
}

/**
 * Projects the caller oversees. The project/course/offering tables are directory data
 * (readable by every profile), so the "who teaches it" rule is applied here exactly as
 * app.teaches_project() does it: COALESCE(offering.faculty_id, course.faculty_id).
 * Counts are rolled up from v_faculty_team_progress (RLS: only teams you oversee).
 * The landing page and the sidebar both use this, so they always list the same projects.
 */
export async function fetchTaughtProjects(who: { role: string; facultyId: string | null }): Promise<TaughtProject[]> {
  const [projects, progress] = await Promise.all([
    supabase
      .from('project')
      .select(
        'project_id, title, description, status, course_code, start_date, end_date, offering_id, course(title, faculty_id), course_offering(faculty_id, term_id, section), milestone(cie_part)',
      )
      .order('project_id'),
    supabase.from('v_faculty_team_progress').select('project_id, members, claims_pending, claims_contested, last_activity'),
  ])
  throwIfError(projects.error)
  throwIfError(progress.error)
  const stats = new Map<string, { teams: number; students: number; pending: number; contested: number; last: string | null }>()
  for (const r of progress.data ?? []) {
    const s = stats.get(r.project_id) ?? { teams: 0, students: 0, pending: 0, contested: 0, last: null }
    s.teams += 1
    s.students += Number(r.members ?? 0)
    s.pending += Number(r.claims_pending ?? 0)
    s.contested += Number(r.claims_contested ?? 0)
    if (r.last_activity && (!s.last || r.last_activity > s.last)) s.last = r.last_activity
    stats.set(r.project_id, s)
  }
  const mine = (projects.data ?? []).filter((p) => {
    if (who.role === 'admin') return true
    const teacher = p.course_offering?.faculty_id ?? p.course?.faculty_id
    return teacher === who.facultyId
  })
  return mine
    .map((p) => {
      const s = stats.get(p.project_id)
      return {
        projectId: p.project_id,
        title: p.title,
        description: p.description,
        status: p.status,
        courseCode: p.course_code,
        courseTitle: p.course?.title ?? p.course_code,
        startDate: p.start_date,
        endDate: p.end_date,
        offering: p.course_offering ? { termId: p.course_offering.term_id, section: p.course_offering.section } : null,
        // same rule as v_lab_cie_marks: lab-structured = has a non-'reduced' component
        isLab: (p.milestone ?? []).some((m) => m.cie_part !== 'reduced'),
        teams: s?.teams ?? 0,
        students: s?.students ?? 0,
        claimsPending: s?.pending ?? 0,
        claimsContested: s?.contested ?? 0,
        lastActivity: s?.last ?? null,
      }
    })
    .sort((a, b) => Number(Boolean(b.offering)) - Number(Boolean(a.offering)) || b.projectId.localeCompare(a.projectId))
}

export function useTaughtProjects() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: facultyKeys.projects(profile?.userId),
    enabled: Boolean(profile),
    queryFn: () => fetchTaughtProjects({ role: profile!.role, facultyId: profile!.facultyId }),
  })
}

export interface ProjectInfo {
  project_id: string
  title: string
  course_code: string
  status: string
  offering_id: number | null
}

/** One project row (directory table). null = no such project. */
export function useProjectInfo(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.project(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectInfo | null> => {
      const { data, error } = await supabase
        .from('project')
        .select('project_id, title, course_code, status, offering_id')
        .eq('project_id', projectId)
        .maybeSingle()
      throwIfError(error)
      return data
    },
  })
}

// ---- rubric sheet -------------------------------------------------------------------------

/** The project's components (milestone is a directory table: every profile can read it). */
export function useMilestones(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.milestones(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Milestone[]> => {
      const { data, error } = await supabase
        .from('milestone')
        .select('project_id, milestone_no, title, max_marks, deadline, cie_part, locked_at')
        .eq('project_id', projectId)
        .order('milestone_no')
      throwIfError(error)
      return data ?? []
    },
  })
}

/** v_rubric_sheet: one row per (student, component), filtered by RLS. */
export function useRubricSheet(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.sheet(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<RubricCell[]> => {
      const { data, error } = await supabase
        .from('v_rubric_sheet')
        .select('*')
        .eq('project_id', projectId)
        .order('team_id')
        .order('name')
        .order('milestone_no')
      throwIfError(error)
      return data ?? []
    },
  })
}

/** v_lab_cie_marks: 120 raw -> 30, + C10 + C11 = 50 (derived, never stored). */
export function useLabCieMarks(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.cie(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<CieRow[]> => {
      const { data, error } = await supabase
        .from('v_lab_cie_marks')
        .select('*')
        .eq('project_id', projectId)
        .order('team_id')
        .order('name')
      throwIfError(error)
      return data ?? []
    },
  })
}

/** v_faculty_team_progress: counts and timestamps per team, no content columns. */
export function useTeamProgress(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.progress(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<TeamProgress[]> => {
      const { data, error } = await supabase
        .from('v_faculty_team_progress')
        .select('*')
        .eq('project_id', projectId)
        .order('team_id')
      throwIfError(error)
      return data ?? []
    },
  })
}

/**
 * Students with recorded work in this project: a contribution row or an artifact version
 * they made (RLS: staff see these for non-private artifacts of projects they oversee; a
 * student sees their own team's). "No recorded evidence yet" is decided from this, not
 * from the claim count: a student can have work on record and simply no claim filed.
 */
export function useProjectEvidence(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.evidence(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Set<string>> => {
      const [contributions, versions] = await Promise.all([
        supabase.from('contribution').select('usn, artifact!inner(project_id)').eq('artifact.project_id', projectId),
        supabase.from('artifact_version').select('created_by, artifact!inner(project_id)').eq('artifact.project_id', projectId),
      ])
      throwIfError(contributions.error)
      throwIfError(versions.error)
      return new Set([...(contributions.data ?? []).map((r) => r.usn), ...(versions.data ?? []).map((r) => r.created_by)])
    },
  })
}

export interface ComponentSignature {
  milestone_no: number
  /** faculty ids who signed marks in this column */
  signers: string[]
  /** the latest signature in the column */
  lastAt: string | null
}

/** Who signed each column of the sheet, and when: the paper sheet's "Signature of Lab Faculty". */
export function useComponentSignatures(projectId: string) {
  return useQuery({
    queryKey: facultyKeys.signatures(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Map<number, ComponentSignature>> => {
      const { data, error } = await supabase
        .from('assessment')
        .select('milestone_no, assessed_by, assessed_at')
        .eq('project_id', projectId)
      throwIfError(error)
      const out = new Map<number, ComponentSignature>()
      for (const r of data ?? []) {
        const s = out.get(r.milestone_no) ?? { milestone_no: r.milestone_no, signers: [], lastAt: null }
        if (!s.signers.includes(r.assessed_by)) s.signers.push(r.assessed_by)
        if (!s.lastAt || r.assessed_at > s.lastAt) s.lastAt = r.assessed_at
        out.set(r.milestone_no, s)
      }
      return out
    },
  })
}

// ---- the claims behind one cell -----------------------------------------------------------

export interface CellEvidence {
  evidence_no: number
  kind: EvidenceKind
  contribution_id: number | null
  artifact_id: string | null
  version_no: number | null
  ref: string | null
  note: string | null
  added_at: string
  contribution: {
    contribution_type: string
    description: string | null
    source: string
    source_ref: string | null
    occurred_at: string | null
    ai_assisted: boolean
  } | null
  artifact_version: {
    created_by: string
    created_at: string
    ai_assistance: AiAssistance
    author: { name: string } | null
    artifact: { title: string; visibility: Visibility; source: string } | null
  } | null
}

export interface CellCountersign {
  endorser_usn: string
  verdict: Verdict
  comment: string | null
  claim_revision: number
  signed_at: string
  endorser: { name: string } | null
}

export interface CellClaim {
  claim_id: number
  usn: string
  team_id: string
  project_id: string
  milestone_no: number
  statement: string
  contribution_type: ContributionType | null
  ai_assistance: AiAssistance
  status: ClaimStatus
  revision: number
  created_at: string
  claimant: { name: string } | null
  claim_evidence: CellEvidence[]
  countersign: CellCountersign[]
}

const CLAIM_SELECT =
  'claim_id, usn, team_id, project_id, milestone_no, statement, contribution_type, ai_assistance, status, revision, created_at, ' +
  'claimant:student!claim_usn_fkey(name), ' +
  'claim_evidence(evidence_no, kind, contribution_id, artifact_id, version_no, ref, note, added_at, ' +
  'contribution(contribution_type, description, source, source_ref, occurred_at, ai_assisted), ' +
  'artifact_version(created_by, created_at, ai_assistance, author:student!artifact_version_created_by_fkey(name), artifact(title, visibility, source))), ' +
  'countersign(endorser_usn, verdict, comment, claim_revision, signed_at, endorser:student!countersign_endorser_usn_fkey(name))'

/** Claims -> evidence -> countersigns for one (student, component). */
export function useCellClaims(cell: { usn: string; projectId: string; milestoneNo: number } | null) {
  return useQuery({
    queryKey: cell ? facultyKeys.cellClaims(cell.usn, cell.projectId, cell.milestoneNo) : [...keys.faculty.all, 'claims', 'none'],
    enabled: Boolean(cell),
    queryFn: async (): Promise<CellClaim[]> => {
      const { data, error } = await supabase
        .from('claim')
        .select(CLAIM_SELECT)
        .eq('usn', cell!.usn)
        .eq('project_id', cell!.projectId)
        .eq('milestone_no', cell!.milestoneNo)
        .order('created_at')
      throwIfError(error)
      const rows = (data ?? []) as unknown as CellClaim[]
      for (const c of rows) {
        c.claim_evidence.sort((a, b) => a.evidence_no - b.evidence_no)
        c.countersign.sort((a, b) => a.signed_at.localeCompare(b.signed_at))
      }
      return rows
    },
  })
}

/** Every claim of one team on one component: both sides of a dispute. */
export function useComponentClaims(ref: { teamId: string; projectId: string; milestoneNo: number } | null) {
  return useQuery({
    queryKey: ref
      ? facultyKeys.componentClaims(ref.teamId, ref.projectId, ref.milestoneNo)
      : [...keys.faculty.all, 'component-claims', 'none'],
    enabled: Boolean(ref),
    queryFn: async (): Promise<CellClaim[]> => {
      const { data, error } = await supabase
        .from('claim')
        .select(CLAIM_SELECT)
        .eq('team_id', ref!.teamId)
        .eq('project_id', ref!.projectId)
        .eq('milestone_no', ref!.milestoneNo)
        .order('created_at')
      throwIfError(error)
      const rows = (data ?? []) as unknown as CellClaim[]
      for (const c of rows) {
        c.claim_evidence.sort((a, b) => a.evidence_no - b.evidence_no)
        c.countersign.sort((a, b) => a.signed_at.localeCompare(b.signed_at))
      }
      return rows
    },
  })
}

export interface VersionRow {
  artifact_id: string
  version_no: number
  created_by: string
  created_at: string
  ai_assistance: AiAssistance
  author: { name: string } | null
}

/** Every version of the given artifacts (the history a dispute comment points at). */
export function useArtifactVersions(artifactIds: string[]) {
  const ids = [...new Set(artifactIds)].sort()
  return useQuery({
    queryKey: facultyKeys.versions(ids.join(',')),
    enabled: ids.length > 0,
    queryFn: async (): Promise<VersionRow[]> => {
      const { data, error } = await supabase
        .from('artifact_version')
        .select('artifact_id, version_no, created_by, created_at, ai_assistance, author:student!artifact_version_created_by_fkey(name)')
        .in('artifact_id', ids)
        .order('artifact_id')
        .order('version_no')
      throwIfError(error)
      return (data ?? []) as unknown as VersionRow[]
    },
  })
}

export interface AssessmentRow {
  marks: number
  remarks: string | null
  assessed_at: string
  assessed_by: string
  faculty: { name: string } | null
}

/** The recorded mark of one cell (with remarks and who signed it). */
export function useCellAssessment(cell: { usn: string; projectId: string; milestoneNo: number } | null) {
  return useQuery({
    queryKey: cell
      ? facultyKeys.assessment(cell.usn, cell.projectId, cell.milestoneNo)
      : [...keys.faculty.all, 'assessment', 'none'],
    enabled: Boolean(cell),
    queryFn: async (): Promise<AssessmentRow | null> => {
      const { data, error } = await supabase
        .from('assessment')
        .select('marks, remarks, assessed_at, assessed_by, faculty(name)')
        .eq('usn', cell!.usn)
        .eq('project_id', cell!.projectId)
        .eq('milestone_no', cell!.milestoneNo)
        .maybeSingle()
      throwIfError(error)
      return data as AssessmentRow | null
    },
  })
}

// ---- writes ---------------------------------------------------------------------------------

export interface RecordMarkInput {
  usn: string
  projectId: string
  milestoneNo: number
  marks: number
  remarks?: string
}

/** record_assessment(): upsert one rubric cell, signed by the calling faculty member. */
export function useRecordAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: RecordMarkInput) =>
      rpc<RecordAssessmentResult>('record_assessment', {
        p_usn: v.usn,
        p_project_id: v.projectId,
        p_milestone_no: v.milestoneNo,
        p_marks: v.marks,
        ...(v.remarks !== undefined ? { p_remarks: v.remarks } : {}),
      }),
    onSuccess: (r, v) => {
      // optimistic-free: patch the sheet cell in place, then refetch the derived views
      qc.setQueryData<RubricCell[]>(facultyKeys.sheet(v.projectId), (rows) =>
        rows?.map((c) =>
          c.usn === v.usn && c.milestone_no === v.milestoneNo ? { ...c, marks: Number(r.marks), assessed_by: r.assessed_by } : c,
        ),
      )
      void qc.invalidateQueries({ queryKey: facultyKeys.sheet(v.projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.cie(v.projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.assessment(v.usn, v.projectId, v.milestoneNo) })
      void qc.invalidateQueries({ queryKey: facultyKeys.signatures(v.projectId) })
    },
  })
}

/** lock_milestone(): the component's marks become final (one-way for faculty). */
export function useLockMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { projectId: string; milestoneNo: number }) =>
      rpc<LockMilestoneResult>('lock_milestone', { p_project_id: v.projectId, p_milestone_no: v.milestoneNo }),
    onSettled: (_r, _e, v) => {
      void qc.invalidateQueries({ queryKey: facultyKeys.milestones(v.projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.sheet(v.projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.signatures(v.projectId) })
    },
  })
}

// ---- contested queue ------------------------------------------------------------------------

/** v_contested_claims: claims a teammate disputed (RLS: only projects you oversee). */
export function useContestedClaims() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...facultyKeys.contested(), profile?.userId],
    enabled: Boolean(profile),
    queryFn: async (): Promise<ContestedRow[]> => {
      const { data, error } = await supabase
        .from('v_contested_claims')
        .select('*')
        .order('last_disputed_at', { ascending: false, nullsFirst: false })
      throwIfError(error)
      return data ?? []
    },
  })
}

// ---- helpers ----------------------------------------------------------------------------------

/** Rows of a CSV file (RFC 4180 quoting). */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
