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
import { supabase } from '@/lib/supabase'

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
/** Base URL of the notes API. Override with VITE_API_URL; defaults to the local dev server. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

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

/** An API failure: `offline` when the service did not answer at all. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly offline: boolean
  constructor(status: number, code: string, message: string, offline = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.offline = offline
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(6000),
    })
  } catch {
    throw new ApiError(0, 'api_offline', `The notes API at ${API_URL} did not answer.`, true)
  }
  if (!res.ok) {
    let code = `http_${res.status}`
    let message = res.statusText || 'Request failed'
    try {
      const body = (await res.json()) as { detail?: { code?: string; message?: string } | string }
      if (typeof body.detail === 'string') message = body.detail
      else if (body.detail) {
        code = body.detail.code ?? code
        message = body.detail.message ?? message
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message)
  }
  return (await res.json()) as T
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
