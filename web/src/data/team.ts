/**
 * Team page data: join_team / leave_team, find_teammates (complements: StudentSkill ÷
 * (Required − Mine)), find_full_cover (textbook division), skill_gap, skill_subtree.
 * Every read runs as the signed-in user (RLS); every write is a SECURITY INVOKER RPC.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '@/data/keys'
import { rpc } from '@/data/rpc'
import type {
  FindTeammatesResult,
  FullCoverResult,
  JoinTeamResult,
  LeaveTeamResult,
  SkillGapResult,
  SkillNode,
  SkillSubtreeResult,
} from '@/data/types'
import { throwIfError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const teamKeys = {
  teams: (projectId: string) => [...keys.team.all, 'teams', projectId] as const,
  finder: (projectId: string) => [...keys.team.all, 'finder', projectId] as const,
  fullCover: (projectId: string) => [...keys.team.all, 'full-cover', projectId] as const,
  gap: (projectId: string) => [...keys.team.all, 'gap', projectId] as const,
  skills: () => [...keys.team.all, 'skills'] as const,
  subtree: (skillId: string) => [...keys.team.all, 'subtree', skillId] as const,
}

export interface TeamMemberRow {
  usn: string
  role: 'lead' | 'member'
  joined_at: string
  name: string
  section: string | null
}

export interface TeamWithMembers {
  team_id: string
  team_name: string
  max_size: number
  topic_title: string | null
  members: TeamMemberRow[]
}

/** Teams of one project with their members (directory tables: any signed-in profile reads them). */
export function useProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.teams(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<TeamWithMembers[]> => {
      const { data, error } = await supabase
        .from('team')
        .select('team_id, team_name, max_size, topic_title, team_member(usn, role, joined_at, student(name, section))')
        .eq('project_id', projectId!)
        .order('team_id')
      throwIfError(error)
      return (data ?? []).map((t) => ({
        team_id: t.team_id,
        team_name: t.team_name,
        max_size: t.max_size,
        topic_title: t.topic_title,
        members: (t.team_member ?? [])
          .map((m) => ({
            usn: m.usn,
            role: m.role as 'lead' | 'member',
            joined_at: m.joined_at,
            name: m.student?.name ?? m.usn,
            section: m.student?.section ?? null,
          }))
          // lead first, then by join date
          .sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || a.joined_at.localeCompare(b.joined_at)),
      }))
    },
  })
}

function useInvalidateTeams() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.team.all }),
      qc.invalidateQueries({ queryKey: keys.hub.all }),
      qc.invalidateQueries({ queryKey: ['nav'] }),
      qc.invalidateQueries({ queryKey: keys.project.all }),
    ])
}

/** join_team(p_team_id): capacity v2, one team per project and enrollment are trigger rules. */
export function useJoinTeam() {
  const invalidate = useInvalidateTeams()
  return useMutation({
    mutationFn: (teamId: string) => rpc<JoinTeamResult>('join_team', { p_team_id: teamId }),
    onSuccess: () => invalidate(),
  })
}

/** leave_team(p_team_id): refused (55000 leave_team_has_history) once you have recorded work. */
export function useLeaveTeam() {
  const invalidate = useInvalidateTeams()
  return useMutation({
    mutationFn: (teamId: string) => rpc<LeaveTeamResult>('leave_team', { p_team_id: teamId }),
    onSuccess: () => invalidate(),
  })
}

/** find_teammates(P): students who cover what I am missing, ranked by coverage. */
export function useFindTeammates(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.finder(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => rpc<FindTeammatesResult>('find_teammates', { p_project_id: projectId! }),
  })
}

/** find_full_cover(P): StudentSkill ÷ Required(P), as a double NOT EXISTS. */
export function useFullCover(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.fullCover(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => rpc<FullCoverResult>('find_full_cover', { p_project_id: projectId! }),
  })
}

/** skill_gap(P): required level vs my declared and verified (evidence-backed) levels. */
export function useSkillGap(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.gap(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => rpc<SkillGapResult>('skill_gap', { p_project_id: projectId! }),
  })
}

export type SkillRow = Pick<SkillNode, 'skill_id' | 'name' | 'category' | 'parent_skill_id'>

/** All skills (directory table): roots for the tree picker. */
export function useSkills() {
  return useQuery({
    queryKey: teamKeys.skills(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SkillRow[]> => {
      const { data, error } = await supabase
        .from('skill')
        .select('skill_id, name, category, parent_skill_id')
        .order('skill_id')
      throwIfError(error)
      return data ?? []
    },
  })
}

/** skill_subtree(root): WITH RECURSIVE over skill.parent_skill_id, depth-first order. */
export function useSkillSubtree(skillId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.subtree(skillId ?? ''),
    enabled: Boolean(skillId),
    queryFn: async () => (await rpc<SkillSubtreeResult>('skill_subtree', { p_skill_id: skillId! })) ?? [],
  })
}
