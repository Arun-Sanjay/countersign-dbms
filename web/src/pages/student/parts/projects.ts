import type { HubCourse } from '@/data/types'
import { LAB_COURSE } from '@/lib/course'
import type { PickerProject } from './ui'

/**
 * The projects a student can pick on the team / notes pages, from semester_hub() courses:
 * one entry per project (current term first; within a term, my teams first, then the lab
 * course's projects, then active projects, newest first).
 */
export function pickerProjects(courses: HubCourse[]): PickerProject[] {
  const seen = new Map<string, PickerProject & { status: string }>()
  for (const c of courses) {
    if (!c.project_id || seen.has(c.project_id)) continue
    seen.set(c.project_id, {
      project_id: c.project_id,
      title: c.project_title ?? c.project_id,
      course_code: c.course_code ?? '',
      current: Boolean(c.is_current_term),
      team_id: c.team_id,
      status: c.project_status ?? '',
    })
  }
  return [...seen.values()].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Number(Boolean(b.team_id)) - Number(Boolean(a.team_id)) ||
      Number(b.course_code === LAB_COURSE) - Number(a.course_code === LAB_COURSE) ||
      Number(b.status === 'active') - Number(a.status === 'active') ||
      b.project_id.localeCompare(a.project_id),
  )
}
