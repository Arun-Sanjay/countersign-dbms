/**
 * Row types for tables/views come from the generated `database.types.ts`
 * (`npm run types:gen`). The RPCs return jsonb, so their shapes are written out here,
 * field for field from the jsonb_build_object(...) calls in 0004_rpc.sql.
 */
import type { Database } from '@/data/database.types'
import type { AiAssistance, ContributionType, EvidenceKind, Verdict } from '@/lib/rules'

type PublicSchema = Database['public']
export type TableRow<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type ViewRow<V extends keyof PublicSchema['Views']> = PublicSchema['Views'][V]['Row']
export type RpcName = keyof PublicSchema['Functions']
export type RpcArgs<F extends RpcName> = PublicSchema['Functions'][F]['Args']

export type AppRole = 'student' | 'faculty' | 'admin'
export type ClaimStatus = 'pending' | 'confirmed' | 'contested'

export type AcademicTerm = TableRow<'academic_term'>
export type HubCourse = Omit<ViewRow<'v_semester_hub'>, 'usn'>

// ---- semester_hub() ---------------------------------------------------------------
export interface SemesterHubStudent {
  role: 'student'
  me: { usn: string; name: string; section: string; semester: number } | null
  current_term: AcademicTerm | null
  courses: HubCourse[]
  countersign_queue: number
}
export interface FacultyProjectSummary {
  project_id: string
  title: string
  teams: number
  students: number
  claims_pending: number
  claims_contested: number
  last_activity: string | null
}
export interface SemesterHubFaculty {
  role: 'faculty'
  me: { faculty_id: string; name: string; designation: string } | null
  current_term: AcademicTerm | null
  offerings: { offering_id: number; course_code: string; course_title: string; term_id: string; section: string }[]
  projects: FacultyProjectSummary[]
}
export interface SemesterHubAdmin {
  role: 'admin'
  current_term: AcademicTerm | null
  counts: { students: number; faculty: number; projects: number; teams: number; claims_contested: number }
}
export type SemesterHub = SemesterHubStudent | SemesterHubFaculty | SemesterHubAdmin

// ---- team ---------------------------------------------------------------------------
export interface JoinTeamResult {
  team_id: string
  project_id: string
  usn: string
  role: 'lead' | 'member'
  members: number
  max_size: number
}
export interface LeaveTeamResult {
  team_id: string
  usn: string
  left: true
  members: number
}

// ---- submission -------------------------------------------------------------------------
export interface SubmitMilestoneResult {
  submission_id: number
  team_id: string
  project_id: string
  milestone_no: number
  attempt_no: number
  submitted_by: string
  artifacts: { artifact_id: string; version_no: number }[]
}

// ---- claims ---------------------------------------------------------------------------------
export interface FileClaimResult {
  claim_id: number
  usn: string
  team_id: string
  project_id: string
  milestone_no: number
  status: ClaimStatus
  evidence: { evidence_no: number; artifact_id: string; version_no: number }[]
}
export interface AddEvidenceResult {
  claim_id: number
  evidence_no: number
  kind: EvidenceKind
  contribution_id: number | null
  artifact_id: string | null
  version_no: number | null
  ref: string | null
}
export interface CountersignResult {
  claim_id: number
  endorser_usn: string
  verdict: Verdict
  revised: boolean
  claim_status: ClaimStatus
}

// ---- marks ----------------------------------------------------------------------------------
export interface RecordAssessmentResult {
  usn: string
  project_id: string
  milestone_no: number
  marks: number
  assessed_by: string
  assessed_at: string
  inserted: boolean
}
export interface LockMilestoneResult {
  project_id: string
  milestone_no: number
  locked_at: string
  marks_recorded: number
  students: number
  unmarked: number
}

// ---- skills ---------------------------------------------------------------------------------
export interface MissingSkill {
  skill_id: string
  name: string
  required_level: number
}
export interface TeammateCandidate {
  usn: string
  name: string
  section: string
  covered: number
  covers_all: boolean
  skills: { skill_id: string; name: string; level: number; required_level: number }[]
}
export interface FindTeammatesResult {
  project_id: string
  usn: string | null
  missing: MissingSkill[]
  candidates: TeammateCandidate[]
}
export type FullCoverResult = { usn: string; name: string; section: string; team_id: string | null }[]

export interface SkillGapRow {
  skill_id: string
  name: string
  required_level: number
  declared_level: number | null
  verified_level: number | null
  status: 'met' | 'below' | 'missing'
}
export interface SkillGapResult {
  project_id: string
  usn: string
  name: string
  met: number
  total: number
  skills: SkillGapRow[]
}
export interface SkillNode {
  skill_id: string
  name: string
  category: string
  parent_skill_id: string | null
  depth: number
  path: string
}
export type SkillSubtreeResult = SkillNode[] | null

// ---- private notes ----------------------------------------------------------------------------
export interface PrivateNote {
  note_id: number
  team_id: string | null
  title: string
  body: string
  created_at: string
  updated_at: string
}
export interface DeleteNoteResult {
  note_id: number
  deleted: true
}

/** Inputs shared by forms and RPC wrappers. */
export interface FileClaimArgs {
  projectId: string
  milestoneNo: number
  contributionType: ContributionType
  statement: string
  aiAssistance?: AiAssistance
  artifactId?: string
}
