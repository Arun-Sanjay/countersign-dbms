/**
 * React Query keys, one namespace per area. Mutations invalidate by prefix, e.g.
 * queryClient.invalidateQueries({ queryKey: keys.project.all }).
 */
export const keys = {
  profile: (userId: string | undefined) => ['profile', userId] as const,
  hub: { all: ['hub'] as const, semester: () => ['hub', 'semester'] as const },
  nav: { projects: (role: string | undefined) => ['nav', 'projects', role] as const },
  team: { all: ['team'] as const },
  project: { all: ['project'] as const, one: (projectId: string) => ['project', projectId] as const },
  notes: { all: ['notes'] as const },
  facultyView: { all: ['faculty-view'] as const },
  faculty: { all: ['faculty'] as const },
  admin: { all: ['admin'] as const },
}
