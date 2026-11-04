/**
 * Private notes: my_private_notes / save_private_note / delete_private_note
 * (SECURITY DEFINER RPCs over private.note; owner-only).
 * Team notes: the FastAPI service (MongoDB elp.notes + immutable elp.note_versions),
 * called with the caller's own Supabase access token; it checks team membership through
 * Postgres as that user.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '@/data/keys'
import { rpc } from '@/data/rpc'
import type { DeleteNoteResult, PrivateNote } from '@/data/types'
import { apiGet } from '@/lib/api'

export const notesKeys = {
  mine: () => [...keys.notes.all, 'private'] as const,
  team: (teamId: string) => [...keys.notes.all, 'team', teamId] as const,
  versions: (noteId: string) => [...keys.notes.all, 'versions', noteId] as const,
}

// ---- private notes (Postgres, schema private) -----------------------------------------------
export function usePrivateNotes(enabled = true) {
  return useQuery({
    queryKey: notesKeys.mine(),
    enabled,
    queryFn: () => rpc<PrivateNote[]>('my_private_notes'),
  })
}

export function useSaveNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { noteId?: number; title: string; body: string; teamId?: string | null }) =>
      rpc<PrivateNote>('save_private_note', {
        p_title: args.title,
        p_body: args.body,
        ...(args.noteId ? { p_note_id: args.noteId } : {}),
        ...(args.teamId ? { p_team_id: args.teamId } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes.all }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: number) => rpc<DeleteNoteResult>('delete_private_note', { p_note_id: noteId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes.all }),
  })
}

// ---- team notes (FastAPI over MongoDB) ---------------------------------------------------------
export { API_URL, ApiError } from '@/lib/api'

export interface TeamNote {
  note_id: string
  team_id: string
  author_usn: string
  title: string
  tags?: string[]
  links?: string[] | null
  status: 'draft' | 'final'
  version: number
  content: string | null
  content_withheld: boolean
  visibility: 'private' | 'team' | 'submitted'
  ai_assistance?: 'none' | 'assisted' | 'generated'
  created_at?: string
  updated_at?: string
  history: { versions: number }
}
export interface TeamNotesResponse {
  team_id: string
  team_name: string
  access: 'member' | 'staff'
  count: number
  notes: TeamNote[]
}
export interface NoteVersion {
  version_id: string
  version: number
  author_usn: string
  content_hash: string
  created_at: string
  backfilled?: boolean
  content_withheld: boolean
}
export interface NoteVersionsResponse {
  note_id: string
  team_id: string
  current_version: number
  count: number
  versions: NoteVersion[]
}

export function useTeamNotes(teamId: string | undefined) {
  return useQuery({
    queryKey: notesKeys.team(teamId ?? ''),
    enabled: Boolean(teamId),
    retry: false,
    queryFn: () => apiGet<TeamNotesResponse>(`/notes?team_id=${encodeURIComponent(teamId!)}`),
  })
}

export function useNoteVersions(noteId: string | undefined) {
  return useQuery({
    queryKey: notesKeys.versions(noteId ?? ''),
    enabled: Boolean(noteId),
    retry: false,
    queryFn: () => apiGet<NoteVersionsResponse>(`/notes/${encodeURIComponent(noteId!)}/versions`),
  })
}
