/**
 * GET /ingest/trace: one push, the Mongo raw event next to the Postgres rows it produced.
 * Admins and teaching faculty only (RLS on ingest_event decides, in the API, as the caller).
 */
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'

export type TraceTarget = { deliveryId: string } | { contributionId: number }

export interface TraceContribution {
  contribution_id: number
  usn: string
  artifact_id: string
  contribution_type: string
  source_ref: string
  occurred_at: string | null
  ai_assisted: boolean
  artifact: { title: string; external_ref: string | null; team_id: string }
}

export interface TraceCommit {
  sha: string
  author_usn: string | null
  committed_at: string | null
  ai_assisted: boolean | null
  files: string[]
  postgres_contributions: TraceContribution[]
  status: 'matched' | 'no_rows'
}

export interface TraceResponse {
  delivery_id: string | null
  pipeline: boolean
  note?: string
  from_contribution: { contribution_id: number; artifact_id: string; source_ref: string | null } | null
  postgres?: {
    ingest_event: {
      delivery_id: string
      repo_full_name: string | null
      team_id: string | null
      status: string
      received_at: string
      projected_at: string | null
      followups_at: string | null
      sender_login: string | null
      mongo_id: string | null
      commit_count: number | null
      contribution_count: number | null
      error: string | null
    }
    artifact_versions: { artifact_id: string; version_no: number; source_ref: string | null; created_by: string; content_hash: string | null }[]
  }
  mongo?: {
    _id: string
    repo: string
    ref: string | null
    before: string | null
    after: string | null
    sender: string | null
    logged_at: string | null
    unattributed_commits: { sha: string; author?: { username?: string } }[]
  } | null
  commits?: TraceCommit[]
  queries?: { postgres: string[]; mongo: string }
}

function path(t: TraceTarget): string {
  return 'deliveryId' in t
    ? `/ingest/trace?delivery_id=${encodeURIComponent(t.deliveryId)}`
    : `/ingest/trace?contribution_id=${t.contributionId}`
}

export function useTrace(target: TraceTarget | null) {
  return useQuery({
    queryKey: ['trace', target],
    enabled: target !== null,
    retry: false,
    queryFn: () => apiGet<TraceResponse>(path(target!), 15_000),
  })
}
