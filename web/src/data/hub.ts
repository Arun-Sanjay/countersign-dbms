/**
 * Semester hub data (student hub page, faculty landing, admin counts) and the per-role
 * project list the sidebar is built from.
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { fetchTaughtProjects } from '@/data/faculty'
import { keys } from '@/data/keys'
import { rpc } from '@/data/rpc'
import type { AppRole, SemesterHub } from '@/data/types'
import { throwIfError } from '@/lib/errors'
import { todayIso } from '@/lib/format'
import { supabase } from '@/lib/supabase'

/** semester_hub(): one call that builds the landing page for the signed-in user. */
export function useSemesterHub() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...keys.hub.semester(), profile?.userId],
    queryFn: () => rpc<SemesterHub>('semester_hub'),
    enabled: Boolean(profile),
  })
}

export interface NavProject {
  projectId: string
  title: string
  /** student: their team in this project */
  teamId?: string | null
  teamName?: string | null
  current: boolean
  /** staff: on the lab CIE (has an Innovative/Final component) */
  isLab?: boolean
}

async function fetchNavProjects(role: AppRole, facultyId: string | null): Promise<NavProject[]> {
  if (role === 'admin' || role === 'faculty') {
    // the same list the landing page shows (faculty.projects rule), so P05 is not dropped
    // just because it has no team yet
    const projects = await fetchTaughtProjects({ role, facultyId })
    return projects.map((p) => ({ projectId: p.projectId, title: p.title, current: p.status !== 'completed', isLab: p.isLab }))
  }
  const hub = await rpc<SemesterHub>('semester_hub')
  if (hub.role === 'student') {
    const seen = new Set<string>()
    return hub.courses
      .filter((c) => c.project_id && c.team_id)
      // current term first, then the newest project (P06 before the fixture's P01)
      .sort(
        (a, b) =>
          Number(b.is_current_term) - Number(a.is_current_term) ||
          (b.project_id ?? '').localeCompare(a.project_id ?? ''),
      )
      .filter((c) => (seen.has(c.project_id!) ? false : (seen.add(c.project_id!), true)))
      .map((c) => ({
        projectId: c.project_id!,
        title: c.project_title ?? c.project_id!,
        teamId: c.team_id,
        teamName: c.team_name,
        current: Boolean(c.is_current_term),
      }))
  }
  return []
}

/** Projects to link in the sidebar: a student's teams, a teacher's projects, admin's labs. */
export function useNavProjects() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...keys.nav.projects(profile?.role), profile?.userId],
    queryFn: () => fetchNavProjects(profile!.role, profile!.facultyId),
    enabled: Boolean(profile),
    staleTime: 60_000,
  })
}

export interface UpcomingMilestone {
  project_id: string
  milestone_no: number
  title: string
  max_marks: number
  deadline: string
  locked: boolean
  cie_part: string
}

/** Upcoming components across the given projects (milestone is a directory table). */
export function useUpcomingMilestones(projectIds: string[], limit = 8) {
  const ids = [...new Set(projectIds)].sort()
  return useQuery({
    queryKey: [...keys.hub.all, 'timeline', ids.join(','), limit],
    enabled: ids.length > 0,
    queryFn: async (): Promise<UpcomingMilestone[]> => {
      const iso = todayIso()
      const { data, error } = await supabase
        .from('milestone')
        .select('project_id, milestone_no, title, max_marks, deadline, locked_at, cie_part')
        .in('project_id', ids)
        .gte('deadline', iso)
        .order('deadline')
        .order('project_id')
        .order('milestone_no')
        .limit(limit)
      throwIfError(error)
      return (data ?? []).map((m) => ({
        project_id: m.project_id,
        milestone_no: m.milestone_no,
        title: m.title,
        max_marks: m.max_marks,
        deadline: m.deadline,
        locked: m.locked_at !== null,
        cie_part: m.cie_part,
      }))
    },
  })
}

/**
 * Projects where the signed-in student has recorded work: a contribution or an artifact
 * version of their own. "No recorded evidence yet" is decided from this, not from the
 * claim count (work on record with no claim filed is "No claims filed yet").
 */
export function useMyEvidenceProjects(usn: string | null) {
  return useQuery({
    queryKey: [...keys.hub.all, 'evidence', usn],
    enabled: Boolean(usn),
    queryFn: async (): Promise<Set<string>> => {
      const [contributions, versions] = await Promise.all([
        supabase.from('contribution').select('artifact!inner(project_id)').eq('usn', usn!),
        supabase.from('artifact_version').select('artifact!inner(project_id)').eq('created_by', usn!),
      ])
      throwIfError(contributions.error)
      throwIfError(versions.error)
      return new Set([...(contributions.data ?? []), ...(versions.data ?? [])].map((r) => r.artifact.project_id))
    },
  })
}

/**
 * Which of these projects are live labs (attached to a course offering, like P06), as
 * opposed to the practice projects from the Test data set that attach to every offering
 * of their course. The hub puts the live lab first.
 */
export function useLiveProjects(projectIds: string[]) {
  const ids = [...new Set(projectIds)].sort()
  return useQuery({
    queryKey: [...keys.hub.all, 'live', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('project').select('project_id').in('project_id', ids).not('offering_id', 'is', null)
      throwIfError(error)
      return new Set((data ?? []).map((p) => p.project_id))
    },
  })
}
