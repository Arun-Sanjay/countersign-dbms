/**
 * Admin directory data: per-table counts (count: 'exact', head: true), app_user personas.
 * Owned by the admin page.
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { keys } from '@/data/keys'
import type { AppRole, TableRow } from '@/data/types'
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
