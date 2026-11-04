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
import raceResults from '@/data/race-results.json'

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
  /** 'migration' = verbatim from supabase/migrations; 'client' = the supabase-js query;
   *  'experiment' = verbatim from experiments/race (the race lab, not the product database). */
  origin: 'migration' | 'client' | 'experiment'
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

/** Innovative Experiment SQL, verbatim (extracted by web/scripts/race-results.mjs). */
type RaceSqlGroup = keyof typeof raceResults.sql
function raceSources(group: RaceSqlGroup): SqlSource[] {
  return raceResults.sql[group].map((x) => ({ label: x.label, sql: x.sql, file: x.file, comment: x.comment || undefined }))
}
function race(group: RaceSqlGroup, extra: RaceSqlGroup[] = []): Pick<SqlPanel, 'sql' | 'file' | 'comment' | 'origin' | 'related'> {
  const [main, ...rest] = raceSources(group)
  if (!main) throw new Error(`no race SQL for ${group}`)
  return {
    origin: 'experiment',
    sql: main.sql,
    file: main.file,
    comment: main.comment,
    related: [...rest, ...extra.flatMap(raceSources)],
  }
}
const RACE_NOTE =
  'Runs in the race lab (docker container elp-race-pg, database race), a throwaway copy of the graded fixture plus schema exp. It is not the product database, so no RLS policy applies; only one capacity mechanism is active at a time (exp.use_strategy).'
const RACE_UNIT_IV: Concept = { unit: 'IV', topic: 'Concurrency control: isolation levels, MVCC snapshots, row locks, SSI' }

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
    related: [helper('private.check_assessment'), helper('private.canonical_marks')],
    rls: ['milestone_select', 'assessment_insert', 'assessment_update'],
    triggers: ['trg_assessment_canonical_marks', 'trg_assessment_check'],
    concepts: [
      { unit: 'III', topic: 'CHECK (marks ≥ 0) + trigger (marks ≤ max_marks)' },
      { unit: 'III', topic: 'CHECK (marks = round(marks, 1)): a second decimal is refused, not rounded by a NUMERIC(4,1) typmod' },
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

  // ======================= search, live activity, ingestion =======================
  'search.chunks': {
    title: 'Search: search_chunks()',
    summary:
      'One SECURITY INVOKER SQL function over the latest version of each document: a keyword list ranked by term rarity (BM25 idf² over the GIN index) and, when a query embedding is given, a cosine list (HNSW), fused by reciprocal rank in one statement. It runs as you, so RLS on artifact_chunk decides what can be found.',
    ...fn('public.search_chunks'),
    related: [helper('private.chunk_markdown'), helper('app.is_team_member'), helper('app.oversees_project')],
    algebra:
      'LATEST = per artifact, the chunk-bearing version with the newest commit time (δ ON artifact ORDER BY created_at DESC)\n' +
      'CAND = σ tsv @@ (t₁ ∨ … ∨ tₙ) ∧ filters ∧ (chunk_no IS NULL ∨ version ∈ LATEST) (Chunk ⋈ Artifact)\n' +
      'FTS = π chunk, row_number() OVER (ORDER BY Σ_{t ∈ chunk} idf(t)² DESC, ts_rank_cd DESC) (CAND),  idf = ln(1 + (N − df + ½)/(df + ½))\n' +
      'VEC = π chunk, row_number() OVER (ORDER BY embedding <=> q⃗) (σ q⃗ ≠ NULL ∧ filters (Chunk ⋈ Artifact))\n' +
      'RRF = γ chunk; Σ 1/(60 + rank) (FTS ⊎ VEC)   ⋈ Chunk ⋈ Artifact ⋈ Student   — RLS: σ artifact_chunk_select, artifact_select',
    rls: ['artifact_chunk_select', 'artifact_select', 'student_select'],
    note: 'Without VOYAGE_API_KEY no query embedding is sent: the vector list is empty and the score is 1/(60 + FTS rank) alone. A natural question matches chunks holding ANY of its words, and a rare word ("provenance") outweighs several common ones ("team", "project"). Pipeline chunks are whole-file snapshots, so only the newest commit’s text is searched; hand-entered chunks are all searched. hnsw.iterative_scan keeps the vector list full even though RLS filters after the index. Faculty only ever match submitted chunks of projects they teach; a student never matches a teammate’s private chunk.',
    concepts: [
      { unit: 'III', topic: 'CTEs, window functions (row_number), UNION ALL + GROUP BY (an outer union of two ranked lists)' },
      { unit: 'III', topic: 'DISTINCT ON: one row (the latest version) per group' },
      { unit: 'III', topic: 'Indexes: GIN for full-text, HNSW for vectors' },
      { unit: 'V', topic: 'Retrieval over semi-structured text kept inside the relational store' },
    ],
  },
  'search.ask': {
    title: 'Ask: an answer only from what you may read',
    summary:
      'POST /ask (FastAPI) calls search_chunks() through PostgREST with YOUR token, fetches those chunks’ text with your token too, and answers only from them with numbered citations. The server checks every citation and keeps only cited sentences.',
    ...client(`
-- api: POST /ask {question, team_id?, author_usn?, since?, limit = 5 (max 10)}
-- 1. retrieval, as the caller (never the service key):
SELECT * FROM search_chunks(:question, p_team_id => :team, p_author_usn => :author,
                            p_since => :since, p_limit => :limit);
-- 2. the text of exactly those chunks, still as the caller (RLS again):
--    GET /rest/v1/artifact_chunk?select=chunk_id,content&chunk_id=in.(:retrieved_ids)
SELECT chunk_id, content FROM artifact_chunk WHERE chunk_id = ANY (:retrieved_ids);
-- 3. answer:
--    ANTHROPIC_API_KEY set: Claude with one citable document per chunk. A citation survives
--      only if it points at a retrieved chunk AND its quoted text is in that chunk; a sentence
--      with no surviving citation is dropped (citation_check.uncited_dropped).
--    otherwise, or if no citation survives: an EXTRACTIVE answer, the best-matching sentence
--      of each of the top 3 chunks, each cited. (No answer is ever refused for lack of a key.)
-- 4. guard: cited chunk_ids ⊆ retrieved chunk_ids; "[n]" written inside a note becomes "［n］",
--    so only the server's own markers link to a source.`),
    related: [helper('public.search_chunks')],
    rls: ['artifact_chunk_select', 'artifact_select'],
    concepts: [
      { unit: 'III', topic: 'The query runs under the caller’s RLS: same question, different row sets' },
      { unit: 'V', topic: 'Retrieval-augmented answers with provenance' },
    ],
  },
  'activity.live': {
    title: 'Live activity (Realtime broadcast)',
    summary:
      'An AFTER INSERT trigger on contribution calls realtime.send() with ids and a timestamp only (no text) on two private topics: team:<id> for the team’s members and project:<id> for the project’s staff. Joining a channel is an RLS check on realtime.messages.',
    ...client(`
-- the browser (staff on the rubric sheet / students on their project page):
--   supabase.channel('project:' || :project, { config: { private: true } })   -- staff
--   supabase.channel('team:' || :team,       { config: { private: true } })   -- students
--     .on('broadcast', { event: 'contribution' }, …).subscribe()
-- Realtime authorises the join by reading realtime.messages AS YOU:
SELECT 1 FROM realtime.messages
WHERE extension = 'broadcast' AND topic = :topic;    -- + countersign_broadcast_select
--   team:<id>     app.is_team_member(id) OR staff of its project
--   project:<id>  app.oversees_project(id)  (teaching faculty, admins; never students)
-- the feed below the live items (history):
SELECT k.contribution_id, k.usn, k.source, k.occurred_at, a.artifact_id, a.title, a.team_id
FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id
WHERE a.project_id = :project            -- (students: AND a.team_id = :my_team)
ORDER BY k.contribution_id DESC LIMIT 10;`),
    related: [helper('private.broadcast_contribution'), helper('app.can_watch_topic')],
    rls: ['countersign_broadcast_select', 'contribution_select', 'artifact_select'],
    triggers: ['trg_contribution_broadcast'],
    note: 'postgres_changes is not used: it would ship whole rows (including descriptions) to every subscriber. Broadcast from the database sends only the metadata the trigger chooses, never for a private artifact, and a student’s channel carries only their own team, the same rows RLS shows them.',
    concepts: [
      { unit: 'III', topic: 'Triggers: AFTER INSERT FOR EACH ROW' },
      { unit: 'III', topic: 'Row-level security on a system table (realtime.messages)' },
    ],
  },
  'project.activity': {
    title: 'GitHub activity',
    summary:
      'The team’s GitHub contributions grouped by commit: source_ref is the commit SHA, description the first line of its message, and each artifact’s external_ref the file path.',
    ...client(`
-- supabase.from('contribution')
--   .select('contribution_id, usn, description, source_ref, occurred_at, ai_assisted, student(name), artifact!inner(artifact_id, title, type, external_ref, team_id)')
--   .eq('source', 'github').eq('artifact.team_id', :team).order('occurred_at', { ascending: false })
SELECT k.source_ref AS sha, k.usn, s.name, k.description AS message, k.occurred_at,
       k.ai_assisted, a.artifact_id, a.title, a.external_ref AS path
FROM contribution k
JOIN student  s ON s.usn = k.usn
JOIN artifact a ON a.artifact_id = k.artifact_id
WHERE k.source = 'github' AND a.team_id = :team
ORDER BY k.occurred_at DESC;
-- grouped in the browser by (sha, usn): one card per commit, its files listed under it`),
    related: [helper('public.project_push')],
    algebra: 'γ sha, usn; list(path) (σ source=github ∧ team=T (Contribution ⋈ Student ⋈ Artifact))',
    rls: ['contribution_select', 'artifact_select', 'student_select'],
    triggers: ['trg_contribution_member_required', 'trg_contribution_broadcast'],
    concepts: [
      { unit: 'III', topic: 'Idempotent projection: UNIQUE (source, source_ref, usn, artifact_id) + ON CONFLICT DO NOTHING' },
      { unit: 'V', topic: 'Raw event in MongoDB (_id = delivery id), projection in Postgres' },
    ],
  },
  'admin.ingest': {
    title: 'Ingestion inbox (ingest_event)',
    summary:
      'One row per webhook delivery, written only by the service-role pipeline RPCs. The Edge Function calls ingest_receive(), which inserts the row and sends the pgmq message in one transaction.',
    ...client(`
-- supabase.from('ingest_event').select('*').order('received_at', { ascending: false }).limit(50)
SELECT delivery_id, event_type, repo_full_name, team_id, status, attempts,
       commit_count, contribution_count, received_at, projected_at, error
FROM ingest_event
ORDER BY received_at DESC
LIMIT 50;
-- "Sync now" = POST /ingest/drain on the API: the worker loop
--   ingest_read() -> upsert Mongo github_events {_id: delivery_id} -> ingest_mark_raw() -> project_push()`),
    related: [helper('public.ingest_receive'), helper('public.ingest_read'), helper('public.ingest_mark_raw'), helper('public.project_push')],
    algebra: 'σ is_admin() ∨ teaches(team.project) (IngestEvent)',
    rls: ['ingest_event_select'],
    note: 'The pipeline RPCs are EXECUTE-granted to service_role only: a signed-in user calling ingest_receive gets 42501. Statuses: queued → raw_stored → projected; failed (retried after the visibility timeout, dead-lettered after 5 attempts); ignored (never queued).',
    concepts: [
      { unit: 'IV', topic: 'One transaction: INSERT + queue send commit or roll back together' },
      { unit: 'IV', topic: 'Idempotency keys make at-least-once delivery safe' },
      { unit: 'V', topic: 'Inbox → log (MongoDB) → projection (Postgres)' },
    ],
  },
  'admin.consistency': {
    title: 'Mongo ↔ Postgres consistency',
    summary:
      'GET /consistency (FastAPI): per team and author, the commits the Mongo raw log credits vs the distinct commit SHAs of github contribution rows in Postgres (read as you). Units: commits on both sides.',
    ...client(`
-- Mongo (api/app/consistency.py): a find, the grouping is done in Python
db.github_events.find(
  { team_id: { $in: teams } },
  { delivery_id: 1, 'commits.sha': 1, 'commits.author_usn': 1,
    'commits.added': 1, 'commits.modified': 1, 'commits.removed': 1 })
-- Postgres, as the caller, page by page (max_rows = 1000):
SELECT a.team_id, k.usn, k.source_ref AS sha
FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id
WHERE k.source = 'github' AND a.team_id = ANY (:teams)
ORDER BY k.contribution_id LIMIT 1000 OFFSET :page;
SELECT team_id, track_paths FROM team_repo WHERE team_id = ANY (:teams);   -- path allow-lists
-- rules, per (team, author):
--   pipeline event   = a Mongo document WITH a delivery_id (fixture pushes without one, and
--                      Postgres rows whose source_ref is not a 40-hex SHA: outside_pipeline)
--   credited commit  = in commits[] (the verified pusher's own); unattributed_commits never count
--   expected         = credited commits that touched a tracked path (artifact type + track_paths)
--   not_projected    = credited commits that touched only untracked files (no row by design)
--   only_in_mongo    = expected − Postgres SHAs        only_in_postgres = Postgres SHAs − logged`),
    rls: ['contribution_select', 'artifact_select', 'team_repo_select'],
    concepts: [
      { unit: 'V', topic: 'Polyglot persistence: reconciling two stores by a shared key (the commit SHA)' },
      { unit: 'III', topic: 'Set difference on keys: A − B and B − A' },
    ],
  },
  'ingest.trace': {
    title: 'Trace one push: Mongo raw event ⇄ Postgres rows',
    summary:
      'GET /ingest/trace (FastAPI, admins and teaching faculty): the delivery’s Mongo document (_id = delivery id) next to the contribution and artifact_version rows it produced, matched by commit SHA. Metadata only; Postgres is read as you.',
    ...client(`
-- who may look: RLS on ingest_event (admin, or teaches the team's project); else 404
SELECT * FROM ingest_event WHERE delivery_id = :delivery;
-- from a live-feed item: its commit SHA -> the version's mongo_ref = the delivery id
SELECT source_ref FROM contribution WHERE contribution_id = :contribution;
SELECT mongo_ref  FROM artifact_version WHERE artifact_id = :artifact AND source_ref = :sha;
-- Mongo: the raw log, without messages, file bodies or e-mail addresses
db.github_events.findOne({ _id: delivery },
  { ref: 1, before: 1, after: 1, sender: 1, logged_at: 1,
    'commits.sha': 1, 'commits.author_usn': 1, 'commits.added': 1, 'commits.modified': 1 })
-- Postgres: what the projection wrote for those SHAs
SELECT contribution_id, usn, artifact_id, source_ref, occurred_at, ai_assisted
FROM contribution k JOIN artifact a USING (artifact_id)
WHERE k.source = 'github' AND k.source_ref = ANY (:shas) AND a.team_id = :team;
SELECT artifact_id, version_no, source_ref, content_hash FROM artifact_version
WHERE mongo_ref = :delivery;`),
    related: [helper('public.project_push'), helper('private.ingest_credit')],
    rls: ['ingest_event_select', 'contribution_select', 'artifact_version_select'],
    concepts: [
      { unit: 'V', topic: 'One business key (delivery id, commit SHA) across two stores' },
      { unit: 'III', topic: 'Joins on a natural key: contribution.source_ref = commit SHA' },
    ],
  },
  // ======================= race arena (Component 10, Innovative Experiment) =======================
  'race.matrix': {
    title: 'The over-admission matrix',
    summary:
      'Per strategy × isolation × N: the share of 1000 races that ended above 4/4, the worst final size, how attempts ended and the p50/p95 latency, from exp.experiment_run and exp.experiment_attempt.',
    ...race('matrix'),
    algebra:
      'Cell(s, iso, n) = γ strategy, isolation, n_clients; avg(over_admitted), max(final_size), avg(admitted), avg(aborts_40001), avg(refused)\n' +
      '                    (ExperimentRun)  ⋈  γ …; percentile_cont(0.5 | 0.95)(latency_ms) (ExperimentRun ⋈ ExperimentAttempt)',
    rls: [],
    note: RACE_NOTE,
    concepts: [RACE_UNIT_IV, { unit: 'III', topic: 'Aggregates, ordered-set aggregates (percentile_cont) and window functions (rank() OVER)' }],
  },
  'race.S1': {
    title: 'S1 · Naive check-then-insert',
    summary: 'The application counts the members, waits 10 ms, and inserts. No lock and no constraint: only SERIALIZABLE (SSI) notices the write skew.',
    ...race('S1', ['common']),
    rls: [],
    note: RACE_NOTE,
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'Write skew through a phantom: each transaction inserts a NEW row the other did not read' }],
  },
  'race.S2': {
    title: 'S2 · Fixture trigger (Q35): lock the team row, then COUNT',
    summary:
      'The graded fixture’s BEFORE INSERT trigger: SELECT … FOR UPDATE on the team row, then COUNT(*). Correct at READ COMMITTED; at REPEATABLE READ the waiter counts with its old snapshot and over-admits.',
    ...race('S2', ['common']),
    rls: [],
    note: RACE_NOTE + ' The trigger is read from supabase/fixture/03_queries.sql (Q35) and loaded unchanged by setup.sh.',
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'Locking a surrogate row: a lock-only conflict raises no 40001 under snapshot isolation' }],
  },
  'race.S3': {
    title: 'S3 · Conditional counter',
    summary: 'The check and the increment are one UPDATE … WHERE member_count < max_size. RC waiters re-check the newest version (EvalPlanQual); RR/SER waiters get 40001.',
    ...race('S3', ['common']),
    rls: [],
    note: RACE_NOTE,
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'Materialize the conflict: the predicate becomes one row that every joiner writes' }],
  },
  'race.S4': {
    title: 'S4 · Naive + retry on 40001',
    summary: 'S1 inside a retry loop. At SERIALIZABLE the losers abort, retry with a fresh snapshot and are refused; below SERIALIZABLE nothing aborts, so the loop never runs.',
    ...race('S4', ['S1', 'common']),
    rls: [],
    note: RACE_NOTE,
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'SSI detects, it does not block: the client must retry' }],
  },
  'race.S6': {
    title: 'S6 · Declarative seat keys',
    summary:
      'Capacity becomes data (seat slots 1..max_size) and the rule becomes keys: a PRIMARY KEY per seat, UNIQUE per student, and a deferred FOREIGN KEY from team_member to its seat.',
    ...race('S6', ['common']),
    rls: [],
    note: RACE_NOTE,
    concepts: [RACE_UNIT_IV, { unit: 'III', topic: 'Declarative integrity: PRIMARY KEY, UNIQUE and a DEFERRABLE INITIALLY DEFERRED foreign key' }],
  },
  'race.S7': {
    title: 'S7 · Write the parent row (product capacity v2)',
    summary: 'The trigger first runs a no-op UPDATE team SET max_size = max_size, so the conflict is write–write: RC waiters re-read, RR/SER waiters get 40001.',
    ...race('S7', ['common']),
    rls: [],
    note: RACE_NOTE + ' Re-created in schema exp from migration 0002’s enforce_team_capacity(), so the migration files stay untouched.',
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'First-updater-wins: a row WRITTEN after your snapshot gives 40001' }],
  },
  'race.precedence': {
    title: 'Precedence graph and conflict-serializability, in SQL',
    summary:
      'Edges from the logical schedule (different transactions, same item, at least one write), cycles with WITH RECURSIVE, and a serial order from topological levels. The committed projection gives the verdict.',
    ...race('precedence'),
    algebra:
      'Edge = π a.txn, b.txn (ρ a (Ops) ⋈ a.item = b.item ∧ a.txn ≠ b.txn ∧ a.seq < b.seq ∧ (a.op = w ∨ b.op = w) ρ b (Ops))\n' +
      'Cycle = transitive closure of Edge (WITH RECURSIVE) that returns to its start',
    rls: [],
    note: RACE_NOTE + ' The schedule is the clients’ LOGICAL view (reads placed at the snapshot they used), not PostgreSQL’s internal MVCC schedule.',
    concepts: [
      { unit: 'IV', topic: 'Conflict serializability: acyclic precedence graph ⇔ conflict-serializable' },
      { unit: 'III', topic: 'Recursive CTE (WITH RECURSIVE) for graph reachability' },
    ],
  },
  'race.live': {
    title: 'Run a live race',
    summary:
      'POST /race/run (FastAPI, faculty and admins): N asyncpg connections race for T02’s one free seat in the race lab, using experiments/race/harness.py itself. Nothing is written to the reported results.',
    ...client(`
-- api/app/race.py -> experiments/race/harness.py (one_client, BODIES), against elp-race-pg:55433/race
SELECT exp.reset_t02();                    -- T02 back to 3/4
SELECT exp.use_strategy(:strategy);        -- enable exactly one capacity mechanism
-- each of the N clients, on its own connection:
BEGIN ISOLATION LEVEL :isolation;          -- BEGIN takes no snapshot yet
--   … asyncio.Barrier: all N wait, then go at once …
--   the strategy's statements (see its card), then
COMMIT;                                    -- or ROLLBACK on "team is full" / 40001 / 40P01
-- outcome per client: admitted | refused | serialization_failure (40001) | deadlock (40P01) | error
SELECT (SELECT count(*) FROM team_member WHERE team_id = 'T02')::int AS final_size,
       (SELECT max_size FROM team WHERE team_id = 'T02')            AS max_size;
SELECT exp.reset_t02(); SELECT exp.use_strategy('S1');   -- leave the lab as the harness does`),
    origin: 'experiment',
    file: 'api/app/race.py → experiments/race/harness.py',
    related: raceSources('common'),
    rls: [],
    note: RACE_NOTE + ' Unlike the harness, a live race writes no exp.experiment_run / attempt / schedule_log rows. One race at a time: 409 race_busy otherwise; 503 race_lab_offline when the container is down (start it with experiments/race/setup.sh).',
    concepts: [RACE_UNIT_IV, { unit: 'IV', topic: 'Transactions: BEGIN ISOLATION LEVEL … COMMIT / ROLLBACK, SQLSTATE 40001 and 40P01' }],
  },
} satisfies Record<string, SqlPanel>

export type SqlPanelId = keyof typeof panels
export const SQL_PANELS: Record<SqlPanelId, SqlPanel> = panels

export function getSqlPanel(id: SqlPanelId): SqlPanel {
  return SQL_PANELS[id]
}
