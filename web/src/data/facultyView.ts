/**
 * "What my faculty sees": v_what_faculty_sees (the caller's own rows, filtered by the
 * faculty branch of the policies and reduced to metadata), plus the contrast: what the
 * same policies keep away from faculty (private artifacts; private notes).
 */
import { useQuery } from '@tanstack/react-query'
import { keys } from '@/data/keys'
import { throwIfError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type FacultyItemKind = 'artifact' | 'artifact_version' | 'contribution' | 'chunk' | 'claim' | 'assessment'

export interface FacultyItem {
  item_kind: FacultyItemKind
  item_ref: string
  team_id: string | null
  project_id: string
  milestone_no: number | null
  label: string
  visibility: 'team' | 'submitted' | null
  ai_assistance: 'none' | 'assisted' | 'generated' | null
  at: string | null
}

export function useWhatFacultySees() {
  return useQuery({
    queryKey: [...keys.facultyView.all, 'items'],
    queryFn: async (): Promise<FacultyItem[]> => {
      const { data, error } = await supabase
        .from('v_what_faculty_sees')
        .select('item_kind, item_ref, team_id, project_id, milestone_no, label, visibility, ai_assistance, at')
        .order('at', { ascending: false, nullsFirst: false })
      throwIfError(error)
      return (data ?? []).map((r) => ({
        item_kind: (r.item_kind ?? 'artifact') as FacultyItemKind,
        item_ref: r.item_ref ?? '',
        team_id: r.team_id,
        project_id: r.project_id ?? '',
        milestone_no: r.milestone_no,
        label: r.label ?? '',
        visibility: r.visibility as FacultyItem['visibility'],
        ai_assistance: r.ai_assistance as FacultyItem['ai_assistance'],
        at: r.at,
      }))
    },
  })
}

export interface HiddenArtifact {
  artifact_id: string
  title: string
  team_id: string
  project_id: string
  milestone_no: number
  created_at: string
}

/** My private artifacts: artifact_select lets only the owner read a 'private' row. */
export function usePrivateArtifacts(usn: string | null) {
  return useQuery({
    queryKey: [...keys.facultyView.all, 'private-artifacts', usn],
    enabled: Boolean(usn),
    queryFn: async (): Promise<HiddenArtifact[]> => {
      const { data, error } = await supabase
        .from('artifact')
        .select('artifact_id, title, team_id, project_id, milestone_no, created_at')
        .eq('visibility', 'private')
        .eq('owner_usn', usn!)
        .order('artifact_id')
      throwIfError(error)
      return data ?? []
    },
  })
}
