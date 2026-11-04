/**
 * "Show the SQL" registry: one entry per data panel. Every SQL text below comes VERBATIM
 * from supabase/migrations (via sources.generated.ts, rebuilt by `npm run sql:extract`),
 * except entries marked origin 'client', which spell out what the supabase-js call asks
 * PostgREST to run as the signed-in user.
 *
 * Page agents: give each data panel `<Panel sqlId="...">` (or `<SqlButton panelId="..."/>`).
 * Add new entries here; referencing a view/function/policy/trigger name that does not
 * exist in the migrations is a type error.
 */
import {
  FUNCTION_SQL,
  POLICY_SQL,
  TRIGGER_SQL,
  VIEW_SQL,
  type FunctionName,
  type PolicyName,
  type TriggerName,
  type ViewName,
} from '@/sql/sources.generated'

export type Unit = 'I' | 'II' | 'III' | 'IV' | 'V'

export const UNIT_TITLES: Record<Unit, string> = {
  I: 'Database approach & ER model',
  II: 'Relational model & relational algebra',
  III: 'SQL, constraints & normalization',
  IV: 'Transactions & concurrency control',
  V: 'NoSQL & big data',
}

export interface Concept {
  unit: Unit
  topic: string
}

export interface SqlSource {
  label: string
  sql: string
  file?: string
  /** The comment block written above it in the migration. */
  comment?: string
}

export interface SqlPanel {
  title: string
  /** One sentence: what this panel runs and why it is safe. */
  summary: string
  /** 'migration' = verbatim from supabase/migrations; 'client' = the supabase-js query. */
  origin: 'migration' | 'client'
  /** The main statement shown first. */
  sql: string
  file?: string
  comment?: string
  /** Helper functions, triggers etc. worth showing beneath the main statement. */
  related?: SqlSource[]
  algebra?: string
  /** Names of the RLS policies that filter or gate this panel. */
  rls: PolicyName[]
  /** Integrity triggers that fire on its writes. */
  triggers?: TriggerName[]
  concepts: Concept[]
  /** Extra caveat shown under the policies (e.g. "SECURITY DEFINER: owner filter in body"). */
  note?: string
}

// ---- builders -----------------------------------------------------------------------------
function view(name: ViewName): Pick<SqlPanel, 'sql' | 'file' | 'comment' | 'origin'> {
  const v = VIEW_SQL[name]
  return { origin: 'migration', sql: v.sql, file: v.file, comment: v.comment }
}
function fn(name: FunctionName): Pick<SqlPanel, 'sql' | 'file' | 'comment' | 'origin'> {
  const f = FUNCTION_SQL[name]
  return { origin: 'migration', sql: f.sql, file: f.file, comment: f.comment }
}
function helper(name: FunctionName): SqlSource {
  const f = FUNCTION_SQL[name]
  return { label: name, sql: f.sql, file: f.file, comment: f.comment }
}
function viewSource(name: ViewName): SqlSource {
  const v = VIEW_SQL[name]
  return { label: name, sql: v.sql, file: v.file, comment: v.comment }
}
function client(sql: string): Pick<SqlPanel, 'sql' | 'origin'> {
  return { origin: 'client', sql: sql.trim() }
}

/** The SQL text of a policy (generated DO-block policies are reconstructed). */
export function policySql(name: PolicyName): { table: string; sql: string; file: string; generated: boolean } {
  return POLICY_SQL[name]
}
/** The CREATE TRIGGER statement and the trigger function's body. */
export function triggerSql(name: TriggerName): { table: string; sql: string; fnName: string; fnSql?: string } {
  const t = TRIGGER_SQL[name]
  const body = (FUNCTION_SQL as Record<string, { sql: string } | undefined>)[t.fn]
  return { table: t.table, sql: t.sql, fnName: t.fn, fnSql: body?.sql }
}

const IDENTITY_HELPERS = [helper('app.current_usn'), helper('app.is_team_member'), helper('app.oversees_project')]

// ---- the registry ----------------------------------------------------------------------------
const panels = {
  // ======================= student: semester hub =======================
  'hub.overview': {
    title: 'Semester hub',
    summary:
      'One RPC builds the landing page for whoever is signed in: a student gets their courses and countersign queue, faculty their projects, an admin directory counts.',
    ...fn('public.semester_hub'),
    related: [
      viewSource('v_semester_hub'),
      helper('app.current_app_role'),
      helper('app.current_usn'),
      helper('app.current_faculty_id'),
      helper('app.is_team_member'),
      helper('app.teaches_project'),
    ],
    algebra:
      'Hub(me) = π term, course_code, course_title, section, faculty_name, project_id, project_title, team_id, team_name, team_role,\n' +
      '              next_milestone_no, next_component, next_deadline, my_claims_pending, my_claims_confirmed, my_claims_contested\n' +
      '          (σ usn=me (Enrollment) ⋈ Offering ⋈ Term ⋈ Course ⋈ Faculty ⟕ Project ⟕ MyTeam ⟕ NextMilestone ⟕ γ status; count(*) (Claim))\n' +
      'Queue(me) = γ count(*) (σ status=pending ∧ usn≠me (Claim) ▷ σ endorser=me (Countersign))',
    rls: ['student_select', 'faculty_select', 'enrollment_select', 'course_offering_select', 'academic_term_select', 'course_select', 'project_select', 'team_select', 'team_member_select', 'milestone_select', 'claim_select', 'countersign_select', 'artifact_select', 'artifact_version_select', 'contribution_select', 'submission_select'],
    note: 'One function, three branches by role: the student branch reads the tables above through v_semester_hub; the faculty branch rolls up v_faculty_team_progress (artifacts, versions, contributions, submissions); the admin branch only counts directory rows. The app.* helpers are SECURITY DEFINER, so their own read of app_user is not filtered by app_user_select.',
    concepts: [
      { unit: 'I', topic: 'External schema: one role-shaped view of the conceptual schema' },
      { unit: 'III', topic: 'Views, LEFT JOIN LATERAL, aggregate FILTER' },
    ],
  },
  'hub.courses': {
    title: 'My courses this term',
    summary: 'A security_invoker view: every base table it reads is filtered by the caller’s RLS policies.',
    ...view('v_semester_hub'),
    related: [helper('app.current_usn')],
    algebra:
      'π course, project, team, next_deadline (σ usn=me (Enrollment) ⋈ Offering ⋈ Term ⋈ Course ⋈ Faculty ⟕ Project ⟕ (TeamMember ⋈ Team))',
    rls: ['enrollment_select', 'course_offering_select', 'academic_term_select', 'course_select', 'faculty_select', 'project_select', 'team_select', 'team_member_select', 'milestone_select', 'claim_select'],
    concepts: [
      { unit: 'I', topic: 'External schema (view) over the conceptual schema' },
      { unit: 'III', topic: 'Outer joins and LATERAL subqueries' },
    ],
  },

  // ======================= student: team =======================
  'team.members': {
    title: 'Team and members',
    summary: 'Directory tables: readable by any signed-in user with a profile; written only through join_team / leave_team.',
    ...client(`
-- supabase.from('team').select('team_id, team_name, max_size, team_member(usn, role, joined_at, student(name))')
--   .eq('project_id', :project)
SELECT t.team_id, t.team_name, t.max_size,
       tm.usn, tm.role, tm.joined_at, s.name
FROM team t
LEFT JOIN team_member tm ON tm.team_id = t.team_id
LEFT JOIN student s      ON s.usn = tm.usn
WHERE t.project_id = :project;`),
    algebra: 'σ project_id=P (Team) ⟕ TeamMember ⟕ Student',
    rls: ['team_select', 'team_member_select', 'student_select'],
    concepts: [{ unit: 'II', topic: 'ER→relational: M:N relationship STUDENT–TEAM as TEAM_MEMBER' }],
  },
  'team.join': {
    title: 'Join a team',
    summary:
      'SECURITY INVOKER RPC: the INSERT runs as you, so RLS applies, and three triggers decide: capacity (race-safe v2), one team per project, enrollment.',
    ...fn('public.join_team'),
    related: [helper('private.enforce_team_capacity_v2'), helper('private.enforce_one_team_per_project'), helper('private.member_role_for_caller')],
    algebra: 'TeamMember ← TeamMember ∪ {(T, me, role)}   if |σ team_id=T (TeamMember)| < max_size(T)',
    rls: ['team_select', 'team_member_select', 'team_member_insert'],
    triggers: ['trg_team_capacity_v2', 'trg_team_member_role', 'trg_team_one_per_project'],
    concepts: [
      { unit: 'IV', topic: 'Write skew / phantom: "serialize by writing the parent row" (capacity v2)' },
      { unit: 'III', topic: 'Triggers for cross-row rules a CHECK cannot express' },
    ],
  },
  'team.leave': {
    title: 'Leave a team',
    summary: 'A student with recorded work cannot leave: the history guard trigger holds even for a direct DELETE.',
    ...fn('public.leave_team'),
    related: [helper('private.guard_member_history')],
    rls: ['team_member_delete'],
    triggers: ['trg_team_member_history_guard'],
    concepts: [
      { unit: 'II', topic: 'Update operations & constraint violations (RESTRICT vs CASCADE)' },
      { unit: 'III', topic: 'BEFORE DELETE trigger as a referential rule' },
    ],
  },
  'team.finder': {
    title: 'Teammate finder',
    summary:
      'Complements, not clones: students outside any team of P who hold the skills you are missing, ranked by how many of them they cover.',
    ...fn('public.find_teammates'),
    related: [helper('app.is_eligible_for_project')],
    algebra:
      'Missing ← π skill (σ project=P (ProjectSkill)) − π skill (σ usn=me ∧ level≥min (StudentSkill))\n' +
      'Candidates ← γ usn; count(*)→covered (StudentSkill ⋈ Missing)   — ranked partial division\n' +
      'Full cover: StudentSkill ÷ (Required(P) − Mine)',
    rls: ['project_select', 'project_skill_select', 'student_skill_select', 'skill_select', 'team_select', 'team_member_select', 'student_select'],
    concepts: [
      { unit: 'II', topic: 'Relational algebra: DIVISION and SET DIFFERENCE' },
      { unit: 'III', topic: 'CTEs, NOT EXISTS, GROUP BY' },
    ],
  },
  'team.full_cover': {
    title: 'Full cover (textbook division)',
    summary: 'Students who hold every required skill of P: relational division written as a double NOT EXISTS.',
    ...fn('public.find_full_cover'),
    algebra:
      'ProjectSkill_P ← σ project=P (ProjectSkill)\n' +
      'Cover ← π usn, skill (σ level ≥ min_level (StudentSkill ⋈ ProjectSkill_P)) ÷ π skill (ProjectSkill_P)\n' +
      '      ≡ { s ∈ Student | ¬∃ ps ∈ ProjectSkill_P : ¬∃ ss ∈ StudentSkill (ss.usn = s.usn ∧ ss.skill = ps.skill ∧ ss.level ≥ ps.min_level) }',
    rls: ['project_select', 'student_select', 'project_skill_select', 'student_skill_select', 'team_member_select', 'team_select'],
    concepts: [{ unit: 'II', topic: 'DIVISION as double NOT EXISTS' }],
  },
  'team.skill_gap': {
    title: 'Skill gap',
    summary: 'Required skills of the project against your declared and verified (evidence-backed) levels.',
    ...fn('public.skill_gap'),
    algebra: 'Gap = Required(P) − Mine = π skill (σ project=P (ProjectSkill)) − π skill (σ usn=me (StudentSkill))',
    rls: ['student_select', 'project_select', 'project_skill_select', 'skill_select', 'student_skill_select', 'skill_evidence_select'],
    concepts: [
      { unit: 'II', topic: 'SET DIFFERENCE; LEFT OUTER JOIN keeps the missing skills' },
      { unit: 'III', topic: 'Derived attribute: verified level from skill_evidence' },
    ],
  },
  'team.skill_tree': {
    title: 'Skill tree',
    summary: 'A skill and all its descendants, through the recursive relationship skill → parent_skill.',
    ...fn('public.skill_subtree'),
    algebra: 'Subtree₀ = σ id=root (Skill);  Subtreeₙ₊₁ = Subtreeₙ ∪ (Skill ⋈ parent_skill_id=skill_id Subtreeₙ)  (fixpoint)',
    rls: ['skill_select'],
    concepts: [
      { unit: 'I', topic: 'Recursive (unary) relationship' },
      { unit: 'III', topic: 'WITH RECURSIVE, SEARCH DEPTH FIRST, CYCLE' },
    ],
  },

  // ======================= student: project =======================
  'project.milestones': {
    title: 'Components and marks',
    summary: 'The rubric sheet view, as a student sees it: only your own team’s rows and only your own marks.',
    ...view('v_rubric_sheet'),
    related: IDENTITY_HELPERS,
    algebra: 'TeamMember ⋈ Team ⋈ Student ⋈ Milestone ⟕ Assessment ⟕ γ status; count(*) (Claim)',
    rls: ['team_member_select', 'team_select', 'student_select', 'milestone_select', 'assessment_select', 'claim_select'],
    concepts: [
      { unit: 'I', topic: 'Weak entity MILESTONE (partial key milestone_no)' },
      { unit: 'III', topic: 'security_invoker view; LEFT JOIN LATERAL' },
    ],
  },
  'project.artifacts': {
    title: 'Artifacts',
    summary: 'Three privacy tiers: private (owner only), team, submitted (also the teaching faculty).',
    ...client(`
-- supabase.from('artifact').select('*, artifact_version(version_no, created_by, created_at, ai_assistance)')
--   .eq('team_id', :team)
SELECT a.*, v.version_no, v.created_by, v.created_at, v.ai_assistance
FROM artifact a
LEFT JOIN artifact_version v ON v.artifact_id = a.artifact_id
WHERE a.team_id = :team;
-- RLS appends artifact_select's USING clause to every row:
--   CASE WHEN visibility = 'private' THEN owner_usn = current_usn()
--        ELSE is_team_member(team_id) OR oversees_project(project_id) END`),
    algebra: 'σ team=T ∧ (vis≠private ∨ owner=me) (Artifact) ⟕ ArtifactVersion',
    rls: ['artifact_select', 'artifact_version_select'],
    triggers: ['trg_artifact_guard'],
    concepts: [
      { unit: 'I', topic: 'Weak entity ARTIFACT_VERSION' },
      { unit: 'III', topic: 'Row-level security as a WHERE clause on every query' },
    ],
  },
  'project.who_built_what': {
    title: 'Who built what',
    summary: 'Every contribution row, joined to the person and the artifact it was made on.',
    ...client(`
-- supabase.from('contribution')
--   .select('contribution_id, contribution_type, description, occurred_at, ai_assisted, student(name), artifact!inner(title, team_id)')
--   .eq('artifact.team_id', :team)
SELECT s.name, a.title, k.contribution_type, k.description,
       COALESCE(k.occurred_at, k.created_at::timestamptz) AS at, k.ai_assisted
FROM contribution k
JOIN student  s ON s.usn = k.usn
JOIN artifact a ON a.artifact_id = k.artifact_id
WHERE a.team_id = :team
ORDER BY at DESC;`),
    algebra: 'π name, title, type (Student ⋈ Contribution ⋈ Artifact)',
    rls: ['contribution_select', 'student_select', 'artifact_select'],
    triggers: ['trg_contribution_member_required'],
    concepts: [
      { unit: 'II', topic: 'Natural join over an M:N relationship (STUDENT–ARTIFACT)' },
      { unit: 'III', topic: 'Inner join with an embedded filter' },
    ],
  },
  'project.claims': {
    title: 'My claims',
    summary: '"Every mark has a receipt": each claim carries its evidence and its teammates’ countersigns.',
    ...client(`
-- supabase.from('claim').select('*, claim_evidence(*), countersign(*)')
--   .eq('project_id', :project).eq('usn', :me)
SELECT c.*, e.*, cs.*
FROM claim c
LEFT JOIN claim_evidence e ON e.claim_id = c.claim_id
LEFT JOIN countersign  cs ON cs.claim_id = c.claim_id
WHERE c.project_id = :project AND c.usn = :me;`),
    related: [helper('private.claim_status'), helper('private.derive_claim_status')],
    algebra: 'σ usn=me (Claim) ⟕ ClaimEvidence ⟕ Countersign',
    rls: ['claim_select', 'claim_evidence_select', 'countersign_select'],
    concepts: [
      { unit: 'I', topic: 'Weak entity CLAIM_EVIDENCE; ternary CLAIM–STUDENT–MILESTONE' },
      { unit: 'III', topic: 'Derived attribute status, maintained by triggers' },
    ],
  },
  'project.file_claim': {
    title: 'File a claim',
    summary:
      '"I did X for component C". The team is derived (one team per project); citing an artifact attaches its latest version as evidence #1, in the same transaction.',
    ...fn('public.file_claim'),
    related: [helper('app.current_usn'), helper('private.guard_claim'), helper('private.check_claim_evidence')],
    rls: ['team_member_select', 'team_select', 'milestone_select', 'claim_insert', 'artifact_select', 'artifact_version_select', 'claim_evidence_insert'],
    triggers: ['trg_claim_guard', 'trg_claim_member_required', 'trg_claim_status_derived', 'trg_claim_evidence_check', 'trg_claim_evidence_revision'],
    concepts: [
      { unit: 'III', topic: 'CHECK constraints mirrored by zod; triggers for cross-table rules' },
      { unit: 'IV', topic: 'One function = one atomic transaction' },
    ],
  },
  'project.add_evidence': {
    title: 'Add evidence',
    summary:
      'Attach a contribution, an artifact version, a commit, a URL or a file to your own pending claim. Each change bumps the claim revision.',
    ...fn('public.add_claim_evidence'),
    related: [helper('private.check_claim_evidence'), helper('private.bump_claim_revision')],
    rls: ['claim_select', 'claim_update', 'contribution_select', 'artifact_version_select', 'claim_evidence_insert'],
    triggers: ['trg_claim_evidence_check', 'trg_claim_evidence_revision'],
    concepts: [
      { unit: 'I', topic: 'Weak entity identified by (claim_id, evidence_no)' },
      { unit: 'IV', topic: 'SELECT … FOR UPDATE to number evidence without a race' },
    ],
  },
  'project.countersign_queue': {
    title: 'Countersign queue',
    summary: 'Teammates’ pending claims you have not signed yet.',
    ...client(`
-- supabase.from('claim').select('*, claim_evidence(*), student(name)')
--   .eq('status', 'pending').neq('usn', :me)   -- then drop the ones I already signed
SELECT c.*
FROM claim c
WHERE c.status = 'pending' AND c.usn <> :me
  AND app.is_team_member(c.team_id)
  AND NOT EXISTS (SELECT 1 FROM countersign cs
                  WHERE cs.claim_id = c.claim_id AND cs.endorser_usn = :me);`),
    algebra: 'σ status=pending ∧ usn≠me (Claim) − π claim (σ endorser=me (Countersign)) ⋈ Claim',
    rls: ['claim_select', 'countersign_select', 'claim_evidence_select'],
    concepts: [{ unit: 'III', topic: 'Anti-join with NOT EXISTS' }],
  },
  'project.countersign': {
    title: 'Countersign a claim',
    summary:
      'A teammate confirms or disputes. Not-self, teammate-only, the lock and the revision check are trigger rules; status is re-derived.',
    ...fn('public.countersign_claim'),
    related: [helper('private.check_countersign'), helper('private.sync_claim_status'), helper('private.claim_status')],
    rls: ['claim_select', 'countersign_insert', 'countersign_update'],
    triggers: ['trg_countersign_check', 'trg_countersign_sync_status', 'trg_claim_status_derived'],
    concepts: [
      { unit: 'IV', topic: 'Optimistic concurrency: claim_revision must match what you read' },
      { unit: 'III', topic: 'Upsert (ON CONFLICT … DO UPDATE); derived attribute via trigger' },
    ],
  },
  'project.submit': {
    title: 'Submit a component',
    summary:
      'One transaction freezes the latest version of each chosen artifact and publishes them to the teaching faculty (team → submitted).',
    ...fn('public.submit_milestone'),
    related: [
      helper('app.current_usn'),
      helper('app.is_team_member'),
      helper('private.check_submission_artifact'),
      helper('private.submission_artifact_same_txn'),
      helper('private.sync_chunk_visibility'),
    ],
    rls: ['team_select', 'milestone_select', 'artifact_select', 'artifact_version_select', 'submission_select', 'submission_insert', 'submission_artifact_select', 'submission_artifact_insert', 'artifact_update'],
    triggers: ['trg_submission_open', 'trg_submission_member_required', 'trg_submission_artifact_check', 'trg_submission_artifact_same_txn', 'trg_artifact_guard', 'trg_artifact_chunk_visibility_sync'],
    concepts: [
      { unit: 'IV', topic: 'Atomicity; advisory lock for the next attempt number' },
      { unit: 'III', topic: 'GROUP BY + max() snapshot; INSERT … SELECT' },
    ],
  },

  // ======================= student: privacy =======================
  'notes.list': {
    title: 'Private notes',
    summary: 'Notes live in schema private, which the API does not expose; this owner-filtered RPC is the only door.',
    ...fn('public.my_private_notes'),
    rls: [],
    note: 'SECURITY DEFINER: schema private has no grants and no policies. The access rule is the explicit `WHERE n.owner_usn = v_usn` in the body.',
    concepts: [
      { unit: 'I', topic: 'Three-schema architecture: an internal schema the external API never sees' },
      { unit: 'V', topic: 'Notes will also be versioned as MongoDB documents (note_versions)' },
    ],
  },
  'notes.save': {
    title: 'Save a note',
    summary: 'Insert or update one of your own notes; someone else’s note id is reported exactly like a missing one.',
    ...fn('public.save_private_note'),
    rls: [],
    note: 'SECURITY DEFINER with an explicit owner filter in every statement.',
    concepts: [{ unit: 'I', topic: 'Privacy by schema: owner-only access' }],
  },
  'notes.delete': {
    title: 'Delete a note',
    summary: 'Owner-only delete; erasure is a procedure, not a cascade.',
    ...fn('public.delete_private_note'),
    rls: [],
    note: 'SECURITY DEFINER with an explicit owner filter.',
    concepts: [{ unit: 'II', topic: 'Delete operation and its constraint checks' }],
  },
  'faculty_view.items': {
    title: 'What my faculty sees',
    summary:
      'Your own rows, filtered the way the faculty branch of the policies filters them: never private, text only once submitted, metadata only.',
    ...view('v_what_faculty_sees'),
    algebra:
      'π kind, ref, label, visibility (σ vis≠private (MyArtifacts)) ∪ (MyVersions) ∪ (MyContributions) ∪ (σ submitted (MyChunks)) ∪ (MyClaims) ∪ (MyMarks)',
    rls: ['artifact_select', 'team_member_select', 'artifact_version_select', 'contribution_select', 'artifact_chunk_select', 'claim_select', 'assessment_select', 'milestone_select'],
    concepts: [
      { unit: 'I', topic: 'External schema per role (view)' },
      { unit: 'III', topic: 'UNION ALL of projections' },
    ],
  },

  // ======================= student pages: extra panels (appended) =======================
  'hub.timeline': {
    title: 'Upcoming components',
    summary: 'The next deadlines across your projects: milestone is a directory table, readable by any signed-in profile.',
    ...client(`
-- supabase.from('milestone').select('project_id, milestone_no, title, max_marks, deadline, locked_at, cie_part')
--   .in('project_id', :my_projects).gte('deadline', CURRENT_DATE).order('deadline').limit(8)
SELECT project_id, milestone_no, title, max_marks, deadline, locked_at, cie_part
FROM milestone
WHERE project_id = ANY (:my_projects)
  AND deadline >= CURRENT_DATE
ORDER BY deadline, project_id, milestone_no
LIMIT 8;`),
    algebra: 'τ deadline (σ project ∈ Mine ∧ deadline ≥ today (Milestone))',
    rls: ['milestone_select'],
    concepts: [
      { unit: 'I', topic: 'Weak entity MILESTONE, identified by (project_id, milestone_no)' },
      { unit: 'III', topic: 'ORDER BY + LIMIT; IN list' },
    ],
  },
  'project.submissions': {
    title: 'Submissions',
    summary: 'Each attempt freezes specific artifact versions (M:N SUBMISSION–ARTIFACT_VERSION). Frozen: no UPDATE or DELETE policy.',
    ...client(`
-- supabase.from('submission')
--   .select('submission_id, milestone_no, attempt_no, submitted_by, submitted_at, submission_artifact(artifact_id, version_no)')
--   .eq('team_id', :team)
SELECT s.submission_id, s.milestone_no, s.attempt_no, s.submitted_by, s.submitted_at,
       sa.artifact_id, sa.version_no
FROM submission s
LEFT JOIN submission_artifact sa ON sa.submission_id = s.submission_id
WHERE s.team_id = :team
ORDER BY s.milestone_no, s.attempt_no;`),
    related: [helper('public.submit_milestone')],
    algebra: 'σ team=T (Submission) ⟕ SubmissionArtifact',
    rls: ['submission_select', 'submission_artifact_select'],
    triggers: ['trg_submission_open', 'trg_submission_artifact_check', 'trg_submission_artifact_same_txn'],
    concepts: [
      { unit: 'I', topic: 'M:N relationship SUBMISSION–ARTIFACT_VERSION' },
      { unit: 'III', topic: 'UNIQUE (team, project, component, attempt) as the backstop' },
    ],
  },
  'notes.team': {
    title: 'Team notes (MongoDB)',
    summary:
      'The FastAPI service verifies your Supabase JWT, checks team membership in Postgres AS YOU (RLS), then reads elp.notes; every save appends an immutable note_versions receipt.',
    ...client(`
-- 1. Postgres, with YOUR token (no service key): which teams may I see?
--    GET /rest/v1/v_faculty_team_progress?team_id=eq.:team   (security_invoker view)
SELECT team_id, team_name
FROM v_faculty_team_progress
WHERE team_id = :team;          -- RLS: app.is_team_member(team_id) OR app.oversees_project(project_id)

-- 2. MongoDB (elp.notes), member tier:
--    db.notes.find({ team_id: :team,
--                    $or: [ { author_usn: :me },
--                           { status: 'final', visibility: { $ne: 'private' } } ] })
--    staff tier: final, non-private notes; content withheld unless visibility = 'submitted'
-- 3. db.note_versions.aggregate([{ $match: { note_id: { $in: ids } } },
--                                { $group: { _id: '$note_id', n: { $sum: 1 } } }])`),
    related: [viewSource('v_faculty_team_progress'), helper('app.is_team_member')],
    algebra: 'Postgres: σ team=T (TeamProgress)  (RLS-filtered);  Mongo: σ team=T ∧ (author=me ∨ (final ∧ vis≠private)) (notes)',
    rls: ['team_select', 'team_member_select'],
    note: 'Not a Postgres query: this panel is served by api/ (FastAPI + MongoDB). The Postgres step runs as the caller, so the same RLS decides team access.',
    concepts: [
      { unit: 'V', topic: 'Document store: notes + append-only note_versions (immutable history)' },
      { unit: 'V', topic: 'Multi-document transaction: version receipt + note bump together' },
    ],
  },
  'faculty_view.hidden': {
    title: 'Never shown to faculty',
    summary:
      'Your private artifacts (artifact_select: owner only) and private notes (schema private, owner-only RPC). The faculty branch of every policy excludes them.',
    ...client(`
-- supabase.from('artifact').select('artifact_id, title, team_id, project_id, milestone_no, created_at')
--   .eq('visibility', 'private').eq('owner_usn', :me)
SELECT artifact_id, title, team_id, project_id, milestone_no, created_at
FROM artifact
WHERE visibility = 'private' AND owner_usn = :me;
-- artifact_select USING:  CASE WHEN visibility = 'private'
--                              THEN owner_usn = current_usn()      -- owner only, never staff
--                              ELSE is_team_member(team_id) OR oversees_project(project_id) END

-- private notes: rpc('my_private_notes')  ->  WHERE n.owner_usn = current_usn()`),
    related: [helper('public.my_private_notes'), helper('app.oversees_project')],
    algebra: 'σ vis=private ∧ owner=me (Artifact)   — the complement of what v_what_faculty_sees returns',
    rls: ['artifact_select'],
    concepts: [
      { unit: 'I', topic: 'Three privacy tiers as an access rule, not a UI filter' },
      { unit: 'III', topic: 'Row-level security: CASE inside a USING clause' },
    ],
  },

  // ======================= faculty =======================
  'faculty.rubric_sheet': {
    title: 'Rubric sheet',
    summary:
      'The paper marks sheet as a live view: one cell per (student, component), with claim counts behind every cell.',
    ...view('v_rubric_sheet'),
    related: [helper('app.is_team_member'), helper('app.oversees_project')],
    algebra: 'TeamMember ⋈ Team ⋈ Student ⋈ Milestone ⟕ Assessment ⟕ γ status; count(*) (Claim)',
    rls: ['team_member_select', 'team_select', 'student_select', 'milestone_select', 'assessment_select', 'claim_select'],
    concepts: [
      { unit: 'III', topic: 'Normalization: the marks sheet (UNF) rebuilt from BCNF tables' },
      { unit: 'III', topic: 'Outer joins: unmarked cells stay as NULL' },
    ],
  },
  'faculty.claim_drawer': {
    title: 'Claims behind a cell',
    summary: 'Claims → evidence → countersigns for one (student, component). Faculty see metadata and submitted content only.',
    ...client(`
-- supabase.from('claim').select('*, claim_evidence(*), countersign(*)')
--   .eq('usn', :usn).eq('project_id', :project).eq('milestone_no', :component)
SELECT c.claim_id, c.statement, c.ai_assistance, c.status, c.revision,
       e.evidence_no, e.kind, e.artifact_id, e.version_no, e.ref, e.note,
       cs.endorser_usn, cs.verdict, cs.comment, cs.signed_at
FROM claim c
LEFT JOIN claim_evidence e ON e.claim_id = c.claim_id
LEFT JOIN countersign  cs ON cs.claim_id = c.claim_id
WHERE c.usn = :usn AND c.project_id = :project AND c.milestone_no = :component;`),
    algebra: 'σ usn=u ∧ project=P ∧ milestone=c (Claim) ⟕ ClaimEvidence ⟕ Countersign',
    rls: ['claim_select', 'claim_evidence_select', 'countersign_select'],
    concepts: [{ unit: 'I', topic: 'Weak entities CLAIM_EVIDENCE and COUNTERSIGN-by-key' }],
  },
  'faculty.record_mark': {
    title: 'Record marks',
    summary: 'Upsert one rubric cell, signed by you. Bounds, the lock and membership are checked by trigger.',
    ...fn('public.record_assessment'),
    related: [helper('private.check_assessment')],
    rls: ['milestone_select', 'assessment_insert', 'assessment_update'],
    triggers: ['trg_assessment_check'],
    concepts: [
      { unit: 'III', topic: 'CHECK (marks ≥ 0) + trigger (marks ≤ max_marks)' },
      { unit: 'IV', topic: 'SELECT … FOR SHARE on the milestone so no mark slips in at lock time' },
    ],
  },
  'faculty.lock': {
    title: 'Lock a component',
    summary: 'Marks become final. One-way for faculty (only an admin can unlock).',
    ...fn('public.lock_milestone'),
    related: [helper('app.oversees_project'), helper('private.guard_milestone_faculty_update')],
    rls: ['milestone_select', 'milestone_update', 'assessment_select', 'team_member_select', 'team_select'],
    triggers: ['trg_milestone_faculty_lock_only'],
    concepts: [{ unit: 'IV', topic: 'Conditional UPDATE … WHERE locked_at IS NULL (no lost update)' }],
  },
  'faculty.contested': {
    title: 'Contested claims',
    summary: 'Claims a teammate disputed, with dispute and confirm counts: the faculty review queue.',
    ...view('v_contested_claims'),
    algebra: 'γ claim; count(dispute), count(confirm) (σ status=contested (Claim) ⋈ Team ⋈ Student ⋈ Milestone ⟕ Countersign)',
    rls: ['claim_select', 'team_select', 'student_select', 'milestone_select', 'countersign_select'],
    concepts: [
      { unit: 'III', topic: 'GROUP BY the primary key: other columns are functionally dependent' },
      { unit: 'III', topic: 'Aggregate FILTER (WHERE …)' },
    ],
  },
  'faculty.progress': {
    title: 'Team progress (metadata only)',
    summary: 'Counts and timestamps per team: no content columns, so it is safe for faculty oversight.',
    ...view('v_faculty_team_progress'),
    algebra: 'π team, counts, last_activity (Team ⋈ Project)  with scalar subqueries per count',
    rls: ['team_select', 'project_select', 'team_member_select', 'artifact_select', 'contribution_select', 'submission_select', 'claim_select', 'artifact_version_select'],
    concepts: [
      { unit: 'I', topic: 'External schema for faculty: metadata only' },
      { unit: 'III', topic: 'Correlated scalar subqueries; GREATEST ignores NULLs' },
    ],
  },
  'faculty.lab_cie_marks': {
    title: 'Lab CIE marks (/50)',
    summary: 'C1–C9 (120 raw) scaled to 30, plus C10 and C11 out of 10 each: derived, never stored.',
    ...view('v_lab_cie_marks'),
    algebra: 'γ usn; Σ marks (TeamMember ⋈ Team ⋈ Lab ⟕ Assessment ⟕ Milestone)  then  reduced_30 = round(raw × 30 / raw_max, 1)',
    rls: ['team_member_select', 'team_select', 'milestone_select', 'assessment_select', 'student_select'],
    concepts: [
      { unit: 'III', topic: 'Derived data in a view (no update anomaly)' },
      { unit: 'III', topic: 'GROUP BY with aggregate FILTER; HAVING' },
    ],
  },
  'faculty.projects': {
    title: 'Projects you teach',
    summary:
      'Directory tables (project, course, course_offering) read as you; the teacher is the offering’s faculty, or the course’s for projects without an offering. Counts are rolled up from the metadata-only progress view.',
    ...client(`
-- supabase.from('project')
--   .select('project_id, title, status, course(title, faculty_id), course_offering(faculty_id, term_id, section)')
-- then keep the rows whose teacher is me (the same rule as app.teaches_project):
SELECT p.project_id, p.title, p.status, c.title AS course_title, o.term_id, o.section
FROM project p
JOIN course c               ON c.course_code = p.course_code
LEFT JOIN course_offering o ON o.offering_id = p.offering_id
WHERE COALESCE(o.faculty_id, c.faculty_id) = app.current_faculty_id()
ORDER BY (o.offering_id IS NOT NULL) DESC, p.project_id DESC;
-- counts per project: supabase.from('v_faculty_team_progress').select('project_id, members, claims_pending, …')
--   summed per project in the browser (the view is security_invoker: only teams you oversee)`),
    related: [helper('app.teaches_project'), viewSource('v_faculty_team_progress')],
    algebra:
      'π project, title, term (σ COALESCE(o.faculty, c.faculty) = me (Project ⋈ Course ⟕ CourseOffering))',
    rls: ['project_select', 'course_select', 'course_offering_select', 'team_select', 'team_member_select', 'claim_select'],
    concepts: [
      { unit: 'II', topic: 'Left outer join: fixture projects have no offering' },
      { unit: 'III', topic: 'COALESCE over a nullable FK: offering teacher overrides course teacher' },
    ],
  },

  // ======================= admin =======================
  'admin.counts': {
    title: 'Directory counts',
    summary: 'Row counts per table, read as the admin (RLS still applies; admins pass every policy).',
    ...client(`
-- for each table: supabase.from(t).select('*', { count: 'exact', head: true })
SELECT count(*) FROM student;      SELECT count(*) FROM faculty;
SELECT count(*) FROM project;      SELECT count(*) FROM team;
SELECT count(*) FROM claim;        SELECT count(*) FROM assessment;  -- …one per table`),
    related: [helper('public.semester_hub'), helper('app.is_admin')],
    rls: ['student_select', 'faculty_select', 'project_select', 'team_select', 'claim_select', 'assessment_select'],
    concepts: [{ unit: 'III', topic: 'Aggregate functions; HEAD requests return only the count' }],
  },
  'admin.personas': {
    title: 'Personas (app_user)',
    summary: 'auth.users → app_user → student | faculty. Each user reads their own row; an admin reads all.',
    ...client(`
-- supabase.from('app_user').select('user_id, role, usn, faculty_id, created_at')
SELECT user_id, role, usn, faculty_id, created_at FROM app_user;`),
    related: [helper('app.current_app_role'), helper('app.is_admin')],
    algebra: 'σ user_id = auth.uid() ∨ is_admin() (AppUser)',
    rls: ['app_user_select'],
    concepts: [
      { unit: 'II', topic: 'Role-consistency CHECK: exactly the id that matches the role' },
      { unit: 'I', topic: 'Specialization: app_user → student | faculty | admin' },
    ],
  },
} satisfies Record<string, SqlPanel>

export type SqlPanelId = keyof typeof panels
export const SQL_PANELS: Record<SqlPanelId, SqlPanel> = panels

export function getSqlPanel(id: SqlPanelId): SqlPanel {
  return SQL_PANELS[id]
}
