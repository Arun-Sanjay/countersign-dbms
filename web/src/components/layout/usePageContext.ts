import { useEffect } from 'react'
import { matchPath, useLocation } from 'react-router'
import { useNavProjects } from '@/data/hub'

interface PageContext {
  /** "Rubric sheet" */
  page: string
  /** "P06" when the route is about one project */
  projectId?: string
  /** "CD252IA Lab 2026-27", when the sidebar knows the project */
  projectTitle?: string
}

const PAGES: [pattern: string, page: string][] = [
  ['/hub', 'Semester hub'],
  ['/team', 'Team & skills'],
  ['/projects/:projectId', 'Project'],
  ['/notes', 'Private notes'],
  ['/faculty-view', 'What my faculty sees'],
  ['/teaching', 'My projects'],
  ['/sheet/:projectId', 'Rubric sheet'],
  ['/marks/:projectId', 'Lab CIE marks'],
  ['/contested', 'Contested claims'],
  ['/admin', 'Directory'],
  ['/about', 'How it works'],
]

/** Which page (and project) the signed-in user is looking at: for the top bar and the tab title. */
export function usePageContext(): PageContext | null {
  const { pathname } = useLocation()
  const projects = useNavProjects()
  for (const [pattern, page] of PAGES) {
    const m = matchPath(pattern, pathname)
    if (!m) continue
    const projectId = m.params.projectId
    const projectTitle = projectId ? projects.data?.find((p) => p.projectId === projectId)?.title : undefined
    return { page, projectId, projectTitle }
  }
  return null
}

/** document.title per route: "Rubric sheet · P06 · Countersign". */
export function useDocumentTitle(ctx: PageContext | null) {
  const title = ctx ? [ctx.page, ctx.projectId, 'Countersign'].filter(Boolean).join(' · ') : 'Countersign · Every mark has a receipt'
  useEffect(() => {
    document.title = title
  }, [title])
}
