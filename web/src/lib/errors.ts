import { isAuthError } from '@supabase/supabase-js'

/**
 * One place that turns any failure (PostgREST, Postgres, Supabase Auth, network) into a
 * friendly message, and, when the database names the input that was wrong, the form field
 * to attach it to.
 *
 * The contract with the database (supabase/migrations 0002–0004):
 *   - every rule raises a real SQLSTATE (PostgREST returns it as `code`);
 *   - DETAIL holds a stable rule key (PostgREST returns it as `details`), e.g. team_capacity;
 *   - plain CHECK / UNIQUE violations name their constraint inside `message`.
 * So the lookup order is: rule key in `details` -> constraint name in `message` -> SQLSTATE.
 */

export type ErrorKind =
  | 'rule' // a business rule said no (locked, full, not pending ...)
  | 'validation' // the input itself is malformed
  | 'permission' // RLS / role / ownership
  | 'not_found'
  | 'conflict' // duplicate or stale (someone else changed it)
  | 'serialization' // 40001 / 40P01: safe to retry
  | 'auth' // sign-in / session problems
  | 'network'
  | 'unknown'

export interface AppError {
  kind: ErrorKind
  /** Short heading, sentence case, no trailing period. */
  title: string
  /** One or two friendly sentences. */
  message: string
  /** Form field the message belongs to (RPC parameter name without the p_ prefix). */
  field?: string
  /** DB rule key (DETAIL) or constraint name, when there is one. */
  rule?: string
  /** SQLSTATE, PostgREST code (PGRSTxxx) or Supabase Auth error code. */
  code?: string
  hint?: string
  /** The original message, for a "technical details" disclosure. */
  raw?: string
}

interface RuleSpec {
  title: string
  /** A fixed sentence, or one built from the raw DB message (to keep its numbers). */
  message: string | ((raw: string) => string)
  field?: string
  kind?: ErrorKind
}

const MEMBERS_ONLY: RuleSpec = {
  title: 'Team members only',
  message: 'Only members of this team can record work in it.',
  kind: 'permission',
}

/**
 * Rule keys raised in DETAIL by the triggers (0002/0003) and RPCs (0004), plus the named
 * CHECK / UNIQUE constraints a direct insert can hit.
 */
export const RULES: Record<string, RuleSpec> = {
  // ---- team membership ----------------------------------------------------------
  team_capacity: {
    title: 'Team is full',
    message: (raw) => {
      const m = /\((\d+) \/ (\d+)\)/.exec(raw)
      return m
        ? `This team already has ${m[1]} of ${m[2]} members. Pick another team.`
        : 'This team already has as many members as it allows. Pick another team.'
    },
    field: 'team_id',
  },
  one_team_per_project: {
    title: 'Already in a team',
    message: 'You are already in a team for this project. A student joins one team per project.',
    field: 'team_id',
  },
  team_member_enrolled_required: {
    title: 'Enrollment required',
    message: "Only students enrolled in this project's course offering can join its teams.",
    field: 'team_id',
    kind: 'permission',
  },
  already_member: {
    title: 'Already a member',
    message: 'You are already a member of this team.',
    field: 'team_id',
    kind: 'conflict',
  },
  team_member_pkey: {
    title: 'Already a member',
    message: 'You are already a member of this team.',
    field: 'team_id',
    kind: 'conflict',
  },
  not_a_member: {
    title: 'Not a member',
    message: 'You are not a member of this team.',
    kind: 'not_found',
  },
  leave_team_has_history: {
    title: 'You cannot leave this team',
    message:
      'You have recorded work here (claims, countersigns, contributions or marks). That history stays with the team it was made in.',
  },
  team_project_immutable: {
    title: 'Project is fixed',
    message: 'This team has members, so its project cannot change.',
  },
  team_member_one_lead: {
    title: 'Team already has a lead',
    message: 'A team has exactly one lead.',
    kind: 'conflict',
  },
  team_not_found: { title: 'Team not found', message: 'That team does not exist.', field: 'team_id', kind: 'not_found' },

  // ---- who may act ----------------------------------------------------------------
  student_required: {
    title: 'Students only',
    message: 'This action is only available to signed-in students.',
    kind: 'permission',
  },
  faculty_required: {
    title: 'Faculty only',
    message: 'Only faculty can record marks.',
    kind: 'permission',
  },
  teaches_project_required: {
    title: 'Not your project',
    message: 'Only the faculty member who teaches this project, or an admin, can do this.',
    kind: 'permission',
  },
  team_member_required: {
    title: 'Team members only',
    message: 'Only a member of this team can do this.',
    kind: 'permission',
  },
  project_member_required: {
    title: 'Join a team first',
    message: 'You need to be in a team for this project before you can file a claim.',
    kind: 'permission',
  },
  profile_required: {
    title: 'No profile linked',
    message: 'This login is not linked to a student or faculty record yet. Ask an admin to link it.',
    kind: 'permission',
  },
  contribution_member_required: MEMBERS_ONLY,
  artifact_chunk_member_required: MEMBERS_ONLY,
  artifact_version_member_required: MEMBERS_ONLY,
  claim_member_required: MEMBERS_ONLY,
  submission_member_required: MEMBERS_ONLY,
  artifact_member_required: { ...MEMBERS_ONLY, message: 'An artifact can only be owned by a member of its team.' },

  // ---- milestones, submissions, artifacts -------------------------------------------
  milestone_locked: {
    title: 'Component is locked',
    message: 'Marks for this component are final, so its claims, countersigns and submissions can no longer change.',
  },
  milestone_faculty_lock_only: {
    title: 'Lock only',
    message: 'Faculty can lock a component, but not edit its other details.',
    kind: 'permission',
  },
  milestone_not_found: {
    title: 'Component not found',
    message: 'This project has no such component.',
    field: 'milestone_no',
    kind: 'not_found',
  },
  artifacts_required: {
    title: 'Nothing selected',
    message: 'Choose at least one artifact to submit.',
    field: 'artifact_ids',
    kind: 'validation',
  },
  artifact_not_found: {
    title: 'Artifact not found',
    message: "That artifact is not one of your team's (or you cannot see it).",
    field: 'artifact_id',
    kind: 'not_found',
  },
  artifact_no_version: {
    title: 'Nothing saved yet',
    message: 'That artifact has no saved version yet. Save a version before citing or submitting it.',
    field: 'artifact_id',
  },
  artifact_private: {
    title: 'Private artifact',
    message: 'Share it with your team before submitting it. Private items are never shown to faculty.',
    field: 'artifact_ids',
  },
  submission_artifact_not_private: {
    title: 'Private artifact',
    message: 'Share it with your team before submitting it. Private items are never shown to faculty.',
    field: 'artifact_ids',
  },
  artifact_not_submitted: {
    title: 'Submit it instead',
    message: 'An artifact becomes "submitted" only by submitting its component.',
  },
  artifact_team_immutable: {
    title: 'Artifact cannot move',
    message: 'An artifact always stays with the team and project it was created in.',
  },
  artifact_submitted_final: {
    title: 'Already submitted',
    message: 'This artifact is submitted, so its visibility, component and owner are final.',
  },
  artifact_owner_only: {
    title: 'Owner only',
    message: 'Only the owner of this artifact can hand it to someone else.',
    kind: 'permission',
  },
  artifact_private_owner_only: {
    title: 'Cannot make it private',
    message: "Teammates have worked on this artifact, so it cannot be made private.",
    kind: 'permission',
  },
  artifact_private_needs_owner: {
    title: 'Private needs an owner',
    message: 'A private artifact must have an owner.',
    kind: 'validation',
  },
  submission_frozen: {
    title: 'Submission is frozen',
    message: 'A submission cannot change once it is made. Submit again to include more artifacts.',
  },
  submission_artifact_same_team: {
    title: "Not your team's artifact",
    message: 'You can only submit artifacts that belong to your own team.',
    field: 'artifact_ids',
  },
  submission_artifact_same_component: {
    title: 'Wrong component',
    message: 'That artifact is filed under a different component.',
    field: 'artifact_ids',
  },
  submission_attempt_key: {
    title: 'Submitted at the same moment',
    message: 'A teammate submitted this component at the same moment. Refresh and try again.',
    kind: 'conflict',
  },

  // ---- claims and evidence -----------------------------------------------------------
  contribution_type: {
    title: 'Pick a type of work',
    message: 'Choose research, design, code, documentation or review.',
    field: 'contribution_type',
    kind: 'validation',
  },
  claim_contribution_type_check: {
    title: 'Pick a type of work',
    message: 'Choose research, design, code, documentation or review.',
    field: 'contribution_type',
    kind: 'validation',
  },
  statement: {
    title: 'Say a little more',
    message: 'Describe the work in at least 10 characters.',
    field: 'statement',
    kind: 'validation',
  },
  claim_statement_check: {
    title: 'Say a little more',
    message: 'Describe the work in at least 10 characters.',
    field: 'statement',
    kind: 'validation',
  },
  ai_assistance: {
    title: 'AI assistance',
    message: 'Declare AI assistance as none, assisted or generated.',
    field: 'ai_assistance',
    kind: 'validation',
  },
  claim_not_found: { title: 'Claim not found', message: 'That claim does not exist, or you cannot see it.', kind: 'not_found' },
  claim_owner_required: {
    title: 'Not your claim',
    message: 'Only the student who filed this claim can add evidence to it.',
    kind: 'permission',
  },
  claim_not_pending: {
    title: 'Claim is already countersigned',
    message: 'A teammate has countersigned this claim, so its text and evidence are frozen.',
  },
  claim_evidence_same_team: {
    title: "Evidence from another team",
    message: "Evidence must come from your own team's work.",
    field: 'ref',
  },
  claim_evidence_own_contribution: {
    title: 'Not your contribution',
    message: 'A claim can only cite your own contributions. Cite the artifact version instead.',
    field: 'ref',
  },
  claim_evidence_ref_format: {
    title: 'Check the reference',
    message: 'A commit is a 7–40 character hex SHA; a URL starts with http:// or https://.',
    field: 'ref',
    kind: 'validation',
  },
  claim_evidence_kind_matches: {
    title: 'Check the reference',
    message: 'The reference does not match the kind of evidence chosen.',
    field: 'ref',
    kind: 'validation',
  },
  claim_evidence_once_contribution: {
    title: 'Already cited',
    message: 'This claim already cites that contribution.',
    field: 'ref',
    kind: 'conflict',
  },
  claim_evidence_once_version: {
    title: 'Already cited',
    message: 'This claim already cites that artifact version.',
    field: 'ref',
    kind: 'conflict',
  },
  // the RPC's own message is the most specific ("A commit reference is a 7-40 character hex SHA")
  ref: { title: 'Check the reference', message: (raw) => sentence(raw), field: 'ref', kind: 'validation' },
  kind: {
    title: 'Pick a kind of evidence',
    message: 'Evidence is a contribution, an artifact version, a commit, a URL or a file.',
    field: 'kind',
    kind: 'validation',
  },

  // ---- countersign ------------------------------------------------------------------------
  verdict: { title: 'Confirm or dispute', message: 'Choose confirm or dispute.', field: 'verdict', kind: 'validation' },
  comment: {
    title: 'Say what is wrong',
    message: 'A dispute needs a comment saying what is wrong.',
    field: 'comment',
    kind: 'validation',
  },
  countersign_dispute_needs_comment: {
    title: 'Say what is wrong',
    message: 'A dispute needs a comment saying what is wrong.',
    field: 'comment',
    kind: 'validation',
  },
  countersign_not_self: {
    title: 'Not your own claim',
    message: 'You cannot countersign your own claim. A teammate has to.',
    kind: 'permission',
  },
  countersign_teammate_required: {
    title: 'Teammates only',
    message: 'Only a teammate of the claimant can countersign this claim.',
    kind: 'permission',
  },
  countersign_stale_revision: {
    title: 'The claim changed',
    message: 'The claim was edited after you opened it. Read the latest version, then sign again.',
    kind: 'conflict',
  },

  // ---- marks --------------------------------------------------------------------------------
  assessment_marks_le_max: {
    title: 'Marks exceed the maximum',
    message: (raw) => {
      const m = /Marks ([\d.]+) exceed the maximum ([\d.]+)/.exec(raw)
      return m
        ? `${m[1]} is more than this component's maximum of ${m[2]}.`
        : "That is more than this component's maximum."
    },
    field: 'marks',
    kind: 'validation',
  },
  assessment_marks_check: {
    title: 'Marks cannot be negative',
    message: 'Enter marks of 0 or more.',
    field: 'marks',
    kind: 'validation',
  },
  // 0007: a direct table write with a second decimal is refused, not rounded
  assessment_marks_one_decimal: {
    title: 'Check the marks',
    message: 'Marks can have at most one decimal place (4.5, not 4.25).',
    field: 'marks',
    kind: 'validation',
  },
  assessment_marks_precision: {
    title: 'Check the marks',
    message: 'Marks must be a number below 1000.',
    field: 'marks',
    kind: 'validation',
  },
  marks: {
    title: 'Check the marks',
    message: 'Marks must be a non-negative number with at most one decimal.',
    field: 'marks',
    kind: 'validation',
  },
  assessment_member_required: {
    title: 'Not in this project',
    message: 'That student is not in any team of this project.',
    field: 'usn',
  },

  // ---- skills, lookup ---------------------------------------------------------------------
  project_not_found: { title: 'Project not found', message: 'That project does not exist.', kind: 'not_found' },
  student_not_found: { title: 'Student not found', message: 'That student does not exist.', field: 'usn', kind: 'not_found' },
  skill_not_found: { title: 'Skill not found', message: 'That skill does not exist.', kind: 'not_found' },
  usn: { title: 'Which student?', message: 'Say which student to look at.', field: 'usn', kind: 'validation' },
  student_skill_level_check: {
    title: 'Level is 1 to 5',
    message: 'A skill level is between 1 and 5.',
    field: 'level',
    kind: 'validation',
  },

  // ---- private notes --------------------------------------------------------------------------
  title: { title: 'Add a title', message: 'A note needs a title of 1–120 characters.', field: 'title', kind: 'validation' },
  note_not_found: { title: 'Note not found', message: 'That note does not exist.', kind: 'not_found' },

  // ---- identity -------------------------------------------------------------------------------
  app_user_role_consistency: {
    title: 'Profile is inconsistent',
    message: 'A student profile needs a USN and a faculty profile needs a faculty id.',
    kind: 'validation',
  },
}

/** SQLSTATE / PostgREST code fallbacks when no rule key is known. */
const CODES: Record<string, { kind: ErrorKind; title: string; message: string }> = {
  '42501': { kind: 'permission', title: 'Not allowed', message: 'You do not have permission to do that.' },
  P0002: { kind: 'not_found', title: 'Not found', message: 'That record does not exist, or you cannot see it.' },
  '22023': { kind: 'validation', title: 'Check your input', message: 'One of the values is not valid.' },
  '22P02': { kind: 'validation', title: 'Check your input', message: 'One of the values has the wrong format.' },
  '22001': { kind: 'validation', title: 'Too long', message: 'One of the values is too long.' },
  '23502': { kind: 'validation', title: 'Something is missing', message: 'A required value is missing.' },
  '23503': {
    kind: 'not_found',
    title: 'Linked record missing',
    message: 'This refers to something that does not exist, or that you cannot see.',
  },
  '23505': { kind: 'conflict', title: 'Already exists', message: 'That already exists.' },
  '23514': { kind: 'validation', title: 'Not allowed', message: 'That value breaks one of the rules.' },
  '23P01': { kind: 'conflict', title: 'Overlaps', message: 'That overlaps an existing record.' },
  '55000': { kind: 'rule', title: 'Not possible right now', message: 'That cannot be done in the current state.' },
  '40001': {
    kind: 'serialization',
    title: 'Changed at the same moment',
    message: 'Someone else changed this at the same moment. Please try again.',
  },
  '40P01': {
    kind: 'serialization',
    title: 'Changed at the same moment',
    message: 'Someone else changed this at the same moment. Please try again.',
  },
  '57014': { kind: 'unknown', title: 'Took too long', message: 'The database took too long to answer.' },
  PGRST116: { kind: 'not_found', title: 'Not found', message: 'That record does not exist, or you cannot see it.' },
  PGRST202: {
    kind: 'unknown',
    title: 'Function missing',
    message: 'That database function is not available. Are the migrations applied?',
  },
  PGRST205: {
    kind: 'unknown',
    title: 'Table missing',
    message: 'That table or view is not available. Are the migrations applied?',
  },
  PGRST301: { kind: 'auth', title: 'Session expired', message: 'Your session expired. Please sign in again.' },
  PGRST303: { kind: 'auth', title: 'Session expired', message: 'Your session expired. Please sign in again.' },
}

/** Supabase Auth error codes (AuthApiError.code). */
const AUTH_CODES: Record<string, { title: string; message: string; field?: string }> = {
  invalid_credentials: { title: 'Wrong email or password', message: 'Check your email and password and try again.', field: 'password' },
  email_not_confirmed: { title: 'Email not confirmed', message: 'Confirm your email address first.', field: 'email' },
  user_not_found: { title: 'No such account', message: 'There is no account with that email.', field: 'email' },
  user_banned: { title: 'Account disabled', message: 'This account has been disabled.' },
  over_request_rate_limit: { title: 'Too many attempts', message: 'Too many attempts. Wait a minute and try again.' },
  session_expired: { title: 'Session expired', message: 'Your session expired. Please sign in again.' },
  session_not_found: { title: 'Session expired', message: 'Your session expired. Please sign in again.' },
  refresh_token_not_found: { title: 'Session expired', message: 'Your session expired. Please sign in again.' },
}

function sentence(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  return /[.!?]$/.test(s) ? s : `${s}.`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

const RULE_KEY = /^[a-z][a-z0-9_]*$/

/** Pull the rule key out of a PostgREST error: DETAIL first, then a named constraint. */
export function ruleKeyOf(details: string | undefined, message: string | undefined): string | undefined {
  if (details && RULE_KEY.test(details)) return details
  const named = message ? /constraint "([a-z0-9_]+)"/.exec(message)?.[1] : undefined
  return named
}

function isNetworkError(e: unknown): boolean {
  if (!isRecord(e)) return false
  const name = str(e.name)
  const message = str(e.message) ?? ''
  return (
    name === 'AuthRetryableFetchError' ||
    (e instanceof TypeError && /fetch|network|load failed/i.test(message)) ||
    /Failed to fetch|NetworkError|ERR_CONNECTION|Load failed/i.test(message)
  )
}

/** Normalise anything thrown or returned as `error` into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppErrorException) return error

  if (isNetworkError(error)) {
    return {
      kind: 'network',
      title: 'Cannot reach the database',
      message: 'The Supabase API did not answer. Check your connection (or that the local stack is running).',
      raw: isRecord(error) ? str(error.message) : undefined,
    }
  }

  if (!isRecord(error)) {
    return { kind: 'unknown', title: 'Something went wrong', message: String(error ?? 'Unknown error') }
  }

  const message = str(error.message) ?? ''
  const code = str(error.code)
  const details = str(error.details)
  const hint = str(error.hint)
  const name = str(error.name)

  // Supabase Auth
  if (isAuthError(error) || name?.startsWith('Auth')) {
    const spec = code ? AUTH_CODES[code] : undefined
    if (spec) return { kind: 'auth', ...spec, code, raw: message }
    if (/invalid login credentials/i.test(message)) {
      return { kind: 'auth', ...AUTH_CODES.invalid_credentials!, code: 'invalid_credentials', raw: message }
    }
    return { kind: 'auth', title: 'Sign-in problem', message: sentence(message || 'Authentication failed'), code, raw: message }
  }

  // PostgREST / Postgres
  const rule = ruleKeyOf(details, message)
  const spec = rule ? RULES[rule] : undefined
  const fallback = code ? CODES[code] : undefined
  if (spec) {
    return {
      kind: spec.kind ?? fallback?.kind ?? 'rule',
      title: spec.title,
      message: typeof spec.message === 'function' ? spec.message(message) : spec.message,
      field: spec.field,
      rule,
      code,
      hint,
      raw: message,
    }
  }

  if (code === '42501' && /row-level security/i.test(message)) {
    return {
      kind: 'permission',
      title: 'Not allowed',
      message: 'Row-level security blocked this: it is not your row to write.',
      rule,
      code,
      hint,
      raw: message,
    }
  }

  if (fallback) {
    // Our RPCs raise readable messages; prefer them over the generic sentence.
    const readable = message && !/violates|relation|syntax|JWT|PGRST/i.test(message)
    return {
      kind: fallback.kind,
      title: fallback.title,
      message: readable ? sentence(message) : fallback.message,
      rule,
      code,
      hint,
      raw: message,
    }
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: sentence(message || 'Unknown error'),
    rule,
    code,
    hint,
    raw: message || undefined,
  }
}

/** An Error subclass that carries the mapped AppError (thrown by data hooks). */
export class AppErrorException extends Error implements AppError {
  readonly kind: ErrorKind
  readonly title: string
  readonly field?: string
  readonly rule?: string
  readonly code?: string
  readonly hint?: string
  readonly raw?: string

  constructor(e: AppError) {
    super(e.message)
    this.name = 'AppError'
    this.kind = e.kind
    this.title = e.title
    this.field = e.field
    this.rule = e.rule
    this.code = e.code
    this.hint = e.hint
    this.raw = e.raw
  }
}

/** Throw a Supabase `{ error }` as a mapped error (use inside queryFn / mutationFn). */
export function throwIfError(error: unknown): void {
  if (error) throw new AppErrorException(toAppError(error))
}

/** "SQLSTATE 23514 · team_capacity" for the technical-details line. */
export function errorTag(e: AppError): string | undefined {
  const parts = [e.code && (/^\d|^P0/.test(e.code) ? `SQLSTATE ${e.code}` : e.code), e.rule].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
