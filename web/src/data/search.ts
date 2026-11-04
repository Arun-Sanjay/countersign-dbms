/**
 * Search and Ask.
 *  - search_chunks(): SECURITY INVOKER RPC, reciprocal rank fusion of the keyword list
 *    (ts_rank_cd over the GIN index) and, when a query embedding is given, the vector list
 *    (HNSW). It runs as the signed-in user, so RLS on artifact_chunk / artifact decides what
 *    can be found: a student finds their own teams' text, faculty only submitted text.
 *  - POST /ask (FastAPI): an answer built ONLY from chunks the caller can retrieve, with
 *    numbered citations. Without an ANTHROPIC_API_KEY the API answers extractively.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { apiPost } from '@/lib/api'
import { throwIfError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const searchKeys = {
  all: ['search'] as const,
  results: (q: SearchParams) => ['search', 'results', q] as const,
  scope: (who: string | undefined) => ['search', 'scope', who] as const,
}

export interface SearchParams {
  query: string
  teamId?: string
  authorUsn?: string
  /** yyyy-mm-dd */
  since?: string
  limit?: number
}

/** One row of search_chunks(). rank_fts / rank_vec are NULL when the chunk is not on that list. */
export interface SearchHit {
  chunk_id: number
  artifact_id: string
  artifact_title: string
  artifact_type: string
  version_no: number
  chunk_no: number | null
  author_usn: string
  author_name: string
  team_id: string
  project_id: string
  visibility: string
  created_at: string
  snippet: string
  score: number
  rank_fts: number | null
  rank_vec: number | null
}

/** RRF constant used by search_chunks (k = 60). */
export const RRF_K = 60

export function useSearchChunks(params: SearchParams | null) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...searchKeys.results(params ?? { query: '' }), profile?.userId],
    enabled: Boolean(profile && params && params.query.trim()),
    queryFn: async (): Promise<SearchHit[]> => {
      const p = params!
      const { data, error } = await supabase.rpc('search_chunks', {
        p_query: p.query.trim(),
        ...(p.teamId ? { p_team_id: p.teamId } : {}),
        ...(p.authorUsn ? { p_author_usn: p.authorUsn } : {}),
        ...(p.since ? { p_since: p.since } : {}),
        p_limit: p.limit ?? 20,
      })
      throwIfError(error)
      return (data ?? []) as unknown as SearchHit[]
    },
  })
}

export interface ScopeTeam {
  team_id: string
  team_name: string
  project_id: string
  members: { usn: string; name: string }[]
}

/**
 * The teams (and their members) the caller can see: the filter options. RLS on team /
 * team_member decides, the same rows the search itself is limited to.
 */
export function useSearchScope() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: searchKeys.scope(profile?.userId),
    enabled: Boolean(profile),
    queryFn: async (): Promise<ScopeTeam[]> => {
      // teams with progress rows = teams I belong to (student) or oversee (staff)
      const { data, error } = await supabase
        .from('v_faculty_team_progress')
        .select('team_id, team_name, project_id')
        .order('team_id')
      throwIfError(error)
      const teams = (data ?? []).filter((t) => t.team_id && t.project_id) as { team_id: string; team_name: string; project_id: string }[]
      if (!teams.length) return []
      const { data: members, error: mErr } = await supabase
        .from('team_member')
        .select('team_id, usn, student(name)')
        .in(
          'team_id',
          teams.map((t) => t.team_id),
        )
      throwIfError(mErr)
      return teams.map((t) => ({
        ...t,
        members: (members ?? [])
          .filter((m) => m.team_id === t.team_id)
          .map((m) => ({ usn: m.usn, name: (m.student as { name: string } | null)?.name ?? m.usn }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
    },
  })
}

// ---- POST /ask ------------------------------------------------------------------------------
/** POST /ask body: the same filters as the search (team, author, since), limit 1-10 (default 5). */
export interface AskRequest {
  question: string
  team_id?: string
  author_usn?: string
  /** YYYY-MM-DD */
  since?: string
  limit?: number
}

/** A citation as the API returns it; only chunk_id is required, the rest is best-effort. */
export interface AskCitation {
  n: number
  chunk_id: number
  artifact_id?: string
  artifact_title?: string
  version_no?: number
  chunk_no?: number | null
  author_usn?: string
  author_name?: string
  team_id?: string
  created_at?: string
  snippet?: string
  quote?: string
}

export interface AskResponse {
  answer: string
  citations: AskCitation[]
  /** 'extractive' without an LLM key, otherwise e.g. 'claude' */
  mode: string
  model?: string | null
  retrieved: number | null
  /** server check: every cited chunk was among the retrieved ones */
  cited_subset_of_retrieved?: boolean | null
  log_id?: string | number | null
}

type RawCitation = Partial<AskCitation> & { index?: number; marker?: number | string; id?: number; text?: string }

/** Accept the API's citation shapes ([{n, chunk_id, …}] or [{index, chunk: {…}}]) and number them. */
export function normalizeAsk(raw: unknown): AskResponse {
  const r = (raw ?? {}) as Record<string, unknown>
  const list = (Array.isArray(r.citations) ? r.citations : Array.isArray(r.sources) ? r.sources : []) as (RawCitation & {
    chunk?: RawCitation
  })[]
  const citations: AskCitation[] = list
    .map((c, i) => {
      const inner = { ...(c.chunk ?? {}), ...c }
      const n = Number(inner.n ?? inner.index ?? inner.marker ?? i + 1)
      const chunkId = Number(inner.chunk_id ?? inner.id)
      return {
        ...inner,
        n: Number.isFinite(n) ? n : i + 1,
        chunk_id: chunkId,
        snippet: inner.snippet ?? inner.quote ?? inner.text,
      } as AskCitation
    })
    .filter((c) => Number.isFinite(c.chunk_id))
  const retrieved = Array.isArray(r.retrieved) ? r.retrieved.length : typeof r.retrieved === 'number' ? r.retrieved : null
  const nested = (r.citation_check ?? {}) as Record<string, unknown>
  const check = r.cited_subset_of_retrieved ?? nested.cited_subset_of_retrieved ?? r.citations_verified ?? null
  return {
    answer: String(r.answer ?? r.text ?? ''),
    citations,
    mode: String(r.mode ?? (r.model ? 'llm' : 'extractive')),
    model: (r.model as string | null | undefined) ?? null,
    retrieved,
    cited_subset_of_retrieved: typeof check === 'boolean' ? check : null,
    log_id: (r.log_id ?? r.query_log_id ?? null) as AskResponse['log_id'],
  }
}

export function useAsk() {
  return useMutation({
    mutationKey: [...searchKeys.all, 'ask'],
    mutationFn: async (req: AskRequest): Promise<AskResponse> =>
      normalizeAsk(await apiPost<unknown>('/ask', req, 30_000)),
  })
}
