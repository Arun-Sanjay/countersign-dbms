/**
 * Admin directory data: per-table counts (count: 'exact', head: true), app_user personas.
 * Owned by the admin page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { keys } from '@/data/keys'
import type { AppRole, TableRow } from '@/data/types'
import { apiGet, apiPost } from '@/lib/api'
import { throwIfError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type TableName = keyof import('@/data/database.types').Database['public']['Tables']

export interface TableGroup {
  label: string
  tables: { name: TableName; note?: string }[]
}

/** Every public table, grouped the way the ER diagram groups them. */
export const TABLE_GROUPS: TableGroup[] = [
  {
    label: 'People and courses',
    tables: [
      { name: 'student' },
      { name: 'faculty' },
      { name: 'app_user', note: 'auth.users → role' },
      { name: 'course' },
      { name: 'academic_term' },
      { name: 'course_offering' },
      { name: 'enrollment' },
    ],
  },
  {
    label: 'Projects and teams',
    tables: [
      { name: 'project' },
      { name: 'milestone', note: 'lab components' },
      { name: 'team' },
      { name: 'team_member' },
    ],
  },
  {
    label: 'Work and evidence',
    tables: [
      { name: 'artifact', note: 'private rows: owner only' },
      { name: 'artifact_version' },
      { name: 'contribution' },
      { name: 'artifact_chunk', note: 'staff: submitted only' },
      { name: 'submission' },
      { name: 'submission_artifact' },
    ],
  },
  {
    label: 'Claims and marks',
    tables: [
      { name: 'claim' },
      { name: 'claim_evidence' },
      { name: 'countersign' },
      { name: 'assessment' },
    ],
  },
  {
    label: 'Ingestion',
    tables: [
      { name: 'ingest_event', note: 'webhook inbox' },
      { name: 'team_repo', note: 'repo → team' },
      { name: 'student_identity', note: 'GitHub login / e-mail → USN' },
    ],
  },
  {
    label: 'Skills',
    tables: [
      { name: 'skill' },
      { name: 'student_skill' },
      { name: 'project_skill' },
      { name: 'course_skill' },
      { name: 'skill_evidence' },
    ],
  },
]

export type TableCounts = Record<string, number | null>

/** One HEAD request per table: PostgREST answers with Content-Range only (no rows). */
export function useTableCounts() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...keys.admin.all, 'counts', profile?.userId],
    enabled: Boolean(profile),
    queryFn: async (): Promise<TableCounts> => {
      const names = TABLE_GROUPS.flatMap((g) => g.tables.map((t) => t.name))
      const results = await Promise.all(
        names.map(async (name) => {
          const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true })
          throwIfError(error)
          return [name, count] as const
        }),
      )
      return Object.fromEntries(results)
    },
  })
}

export interface PersonaRow {
  user_id: string
  role: AppRole
  usn: string | null
  faculty_id: string | null
  created_at: string
  student: Pick<TableRow<'student'>, 'name' | 'section' | 'semester'> | null
  faculty: Pick<TableRow<'faculty'>, 'name' | 'designation'> | null
}

/** app_user rows (an admin reads all of them; anyone else only their own: app_user_select). */
export function useAppUsers() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...keys.admin.all, 'app_user', profile?.userId],
    enabled: Boolean(profile),
    queryFn: async (): Promise<PersonaRow[]> => {
      const { data, error } = await supabase
        .from('app_user')
        .select('user_id, role, usn, faculty_id, created_at, student(name, section, semester), faculty(name, designation)')
        .order('role')
        .order('created_at')
      throwIfError(error)
      return (data ?? []) as unknown as PersonaRow[]
    },
  })
}

// ---- ingestion (inbox, worker drain, Mongo <-> Postgres consistency) ---------------------------
export type IngestEvent = TableRow<'ingest_event'>

/** The latest webhook deliveries (ingest_event_select: admins see all, faculty their projects'). */
export function useIngestEvents(limit = 50) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...keys.admin.all, 'ingest_event', profile?.userId, limit],
    enabled: Boolean(profile),
    queryFn: async (): Promise<IngestEvent[]> => {
      const { data, error } = await supabase
        .from('ingest_event')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(limit)
      throwIfError(error)
      return data ?? []
    },
  })
}

/** Whatever counters POST /ingest/drain answers with, read leniently. */
export interface DrainSummary {
  read: number | null
  projected: number | null
  failed: number | null
  contributions: number | null
  raw: Record<string, unknown>
}

function pickCount(r: Record<string, unknown>, ...names: string[]): number | null {
  for (const n of names) {
    const v = r[n]
    if (typeof v === 'number') return v
    if (Array.isArray(v)) return v.length
  }
  return null
}

export function summarizeDrain(raw: unknown): DrainSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    read: pickCount(r, 'read', 'processed', 'messages', 'count', 'drained'),
    projected: pickCount(r, 'projected', 'ok'),
    failed: pickCount(r, 'failed', 'errors'),
    contributions: pickCount(r, 'contributions'),
    raw: r,
  }
}

/** "Sync now": the API runs the worker loop once (ingest_read → Mongo → ingest_mark_raw → project_push). */
export function useDrainIngest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<DrainSummary> => summarizeDrain(await apiPost<unknown>('/ingest/drain', {}, 60_000)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.all })
      void qc.invalidateQueries({ queryKey: ['consistency'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

export interface ConsistencyAuthor {
  usn: string
  mongo_commits: number
  postgres_github_contributions: number
  /** distinct commit SHAs in Postgres: the unit to compare with mongo_commits */
  postgres_commits?: number
  only_in_mongo: string[]
  only_in_postgres: string[]
  /** SHAs in both stores (newer API builds) */
  matched?: number
  /** pipeline commits that touched no tracked path: nothing to project, by design */
  not_projected?: string[]
  /** evidence that never went through the pipeline (seeded / fixture rows) */
  outside_pipeline?: { mongo_commits: number; postgres_contributions: number }
  status: 'consistent' | 'only_in_mongo' | 'only_in_postgres' | 'mismatch' | 'outside_pipeline' | (string & {})
}
export interface ConsistencyTeam {
  team_id: string
  team_name: string
  project_id: string
  access: string
  mongo_commits: number
  postgres_github_contributions: number
  consistent: boolean
  matched_commits?: number
  status?: string
  pipeline_events?: Record<string, number>
  note: string | null
  authors: ConsistencyAuthor[]
}
export interface ConsistencyReport {
  role: string
  teams: ConsistencyTeam[]
  all_consistent: boolean
}

export function useConsistency() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['consistency', profile?.userId],
    enabled: Boolean(profile),
    retry: false,
    queryFn: () => apiGet<ConsistencyReport>('/consistency', 15_000),
  })
}
