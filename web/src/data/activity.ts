/**
 * Live activity: Supabase Realtime BROADCAST on private topics.
 *
 * The database sends it (trigger trg_contribution_broadcast -> realtime.send) when a
 * contribution row is inserted, e.g. by the ingestion worker's project_push(), on two topics:
 *   'team:<team_id>'     the team's members (and the project's staff): student pages
 *   'project:<id>'       the project's teaching faculty and admins only: the rubric sheet
 * The payload is METADATA ONLY: contribution_id, team_id, usn, artifact_id, occurred_at,
 * source; nothing is sent for a private artifact. Who may join is decided by the RLS policy
 * countersign_broadcast_select on realtime.messages (app.can_watch_topic), so a student never
 * receives another team's activity, the same rows RLS hides from them in the tables.
 *
 * The history below the live entries is read from contribution + artifact as the caller,
 * under the same RLS as everything else.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { facultyKeys } from '@/data/faculty'
import { keys } from '@/data/keys'
import { throwIfError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const activityKeys = {
  all: ['activity'] as const,
  recent: (projectId: string, teamId: string | undefined) => ['activity', 'recent', projectId, teamId ?? '*'] as const,
  timeline: (projectId: string, teamId: string) => ['activity', 'timeline', projectId, teamId] as const,
}

/** The broadcast payload, exactly as private.broadcast_contribution() builds it. */
export interface ContributionBroadcast {
  contribution_id: number
  team_id: string | null
  usn: string
  artifact_id: string
  occurred_at: string
  source: string
}

export interface ActivityItem extends ContributionBroadcast {
  name: string | null
  artifact_title: string | null
  external_ref: string | null
  /** arrived over Realtime while this page was open */
  live: boolean
}

export type LiveStatus = 'connecting' | 'live' | 'denied' | 'error' | 'closed'

async function enrich(events: ContributionBroadcast[]): Promise<ActivityItem[]> {
  const artifactIds = [...new Set(events.map((e) => e.artifact_id))]
  const usns = [...new Set(events.map((e) => e.usn))]
  // metadata only, read as the caller (artifact_select / student_select decide)
  const [arts, people] = await Promise.all([
    supabase.from('artifact').select('artifact_id, title, external_ref').in('artifact_id', artifactIds),
    supabase.from('student').select('usn, name').in('usn', usns),
  ])
  const art = new Map((arts.data ?? []).map((a) => [a.artifact_id, a]))
  const who = new Map((people.data ?? []).map((s) => [s.usn, s.name]))
  return events.map((e) => ({
    ...e,
    name: who.get(e.usn) ?? null,
    artifact_title: art.get(e.artifact_id)?.title ?? null,
    external_ref: art.get(e.artifact_id)?.external_ref ?? null,
    live: true,
  }))
}

/** "New evidence: 1RV24CY033 · ER diagram decisions · obsidian" */
export function evidenceLine(e: Pick<ActivityItem, 'usn' | 'artifact_id' | 'artifact_title' | 'source'>): string {
  return `New evidence: ${e.usn} · ${e.artifact_title ?? e.artifact_id} · ${e.source}`
}

/**
 * Subscribe to team:<teamId> when a team is given (students), else project:<projectId>
 * (staff). New contributions become toasts and live feed items, and the sheet / progress /
 * project queries are invalidated so the page refreshes itself.
 */
export function useProjectLive(projectId: string, opts: { teamId?: string; toasts?: boolean; enabled?: boolean } = {}) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [items, setItems] = useState<ActivityItem[]>([])
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })
  const teamIdDep = opts.teamId
  const enabled = opts.enabled !== false

  useEffect(() => {
    if (!projectId || !profile || !enabled) return
    // mutable per-subscription state (one object: no closure variable is reassigned)
    const sub: { disposed: boolean; buffer: ContributionBroadcast[]; timer?: ReturnType<typeof setTimeout> } = {
      disposed: false,
      buffer: [],
    }

    const flush = async () => {
      const { teamId, toasts = true } = optsRef.current
      const batch = sub.buffer.splice(0).filter((e) => !teamId || e.team_id === teamId)
      sub.timer = undefined
      if (!batch.length || sub.disposed) return
      const enriched = await enrich(batch).catch(() =>
        batch.map((e) => ({ ...e, name: null, artifact_title: null, external_ref: null, live: true })),
      )
      if (sub.disposed) return
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.contribution_id))
        return [...enriched.filter((e) => !seen.has(e.contribution_id)).reverse(), ...prev].slice(0, 50)
      })
      if (toasts) {
        const first = enriched[0]!
        const more = enriched.length - 1
        toast.info(evidenceLine(first), {
          id: `evidence-${first.contribution_id}`,
          duration: 8000,
          description: `${first.name ?? first.usn}${first.team_id ? ` · ${first.team_id}` : ''}${more > 0 ? ` · +${more} more in this push` : ''}`,
        })
      }
      void qc.invalidateQueries({ queryKey: facultyKeys.sheet(projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.progress(projectId) })
      void qc.invalidateQueries({ queryKey: facultyKeys.evidence(projectId) })
      void qc.invalidateQueries({ queryKey: keys.project.one(projectId) })
      void qc.invalidateQueries({ queryKey: activityKeys.all })
      void qc.invalidateQueries({ queryKey: keys.hub.all })
    }

    const topic = teamIdDep ? `team:${teamIdDep}` : `project:${projectId}`
    const channel = supabase.channel(topic, { config: { private: true } })
    channel.on('broadcast', { event: 'contribution' }, (msg) => {
      const p = msg.payload as ContributionBroadcast | undefined
      if (!p || typeof p.contribution_id !== 'number') return
      sub.buffer.push(p)
      // one toast per push: a push of five files is five contributions within a few ms
      if (!sub.timer) sub.timer = setTimeout(() => void flush(), 700)
    })

    void (async () => {
      // private channels authorise with the user's JWT (RLS on realtime.messages)
      await supabase.realtime.setAuth()
      if (sub.disposed) return
      channel.subscribe((s, err) => {
        if (sub.disposed) return
        if (s === 'SUBSCRIBED') setStatus('live')
        else if (s === 'CHANNEL_ERROR') setStatus(/unauthori[sz]ed|denied|permission/i.test(String(err?.message ?? '')) ? 'denied' : 'error')
        else if (s === 'TIMED_OUT') setStatus('error')
        else if (s === 'CLOSED') setStatus('closed')
      })
    })()

    return () => {
      sub.disposed = true
      if (sub.timer) clearTimeout(sub.timer)
      void supabase.removeChannel(channel)
    }
  }, [projectId, teamIdDep, enabled, profile, qc])

  return { status, items }
}

/** The latest contributions of the project (or one team): the feed below the live items. */
export function useRecentActivity(projectId: string, teamId?: string, limit = 12) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...activityKeys.recent(projectId, teamId), profile?.userId],
    enabled: Boolean(profile && projectId),
    queryFn: async (): Promise<ActivityItem[]> => {
      let q = supabase
        .from('contribution')
        .select(
          'contribution_id, usn, source, occurred_at, created_at, artifact!contribution_artifact_id_fkey!inner(artifact_id, title, external_ref, team_id, project_id), student!contribution_usn_fkey(name)',
        )
        .eq('artifact.project_id', projectId)
        .order('contribution_id', { ascending: false })
        .limit(limit)
      if (teamId) q = q.eq('artifact.team_id', teamId)
      const { data, error } = await q
      throwIfError(error)
      return (data ?? []).map((k) => ({
        contribution_id: k.contribution_id,
        team_id: k.artifact.team_id,
        usn: k.usn,
        artifact_id: k.artifact.artifact_id,
        occurred_at: k.occurred_at ?? k.created_at,
        source: k.source,
        name: k.student?.name ?? null,
        artifact_title: k.artifact.title,
        external_ref: k.artifact.external_ref,
        live: false,
      }))
    },
  })
}

// ---- GitHub timeline (project page, Activity tab) -------------------------------------------
export interface CommitFile {
  contribution_id: number
  artifact_id: string
  artifact_title: string
  path: string | null
  artifact_type: string
  contribution_type: string
}

export interface CommitGroup {
  sha: string
  message: string | null
  usn: string
  name: string
  at: string
  ai_assisted: boolean
  files: CommitFile[]
}

/**
 * The team's GitHub contributions grouped by commit: contribution.source_ref is the commit
 * SHA (one row per commit × author × artifact), description is the first line of the message.
 */
export function useCommitTimeline(projectId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: activityKeys.timeline(projectId, teamId ?? ''),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CommitGroup[]> => {
      const { data, error } = await supabase
        .from('contribution')
        .select(
          'contribution_id, usn, contribution_type, description, source_ref, occurred_at, created_at, ai_assisted, student!contribution_usn_fkey(name), artifact!contribution_artifact_id_fkey!inner(artifact_id, title, type, external_ref, team_id)',
        )
        .eq('source', 'github')
        .eq('artifact.team_id', teamId!)
        .order('occurred_at', { ascending: false })
        .limit(500)
      throwIfError(error)
      const groups = new Map<string, CommitGroup>()
      for (const k of data ?? []) {
        const sha = k.source_ref ?? `#${k.contribution_id}`
        const key = `${sha}:${k.usn}`
        let g = groups.get(key)
        if (!g) {
          g = {
            sha,
            message: k.description,
            usn: k.usn,
            name: k.student?.name ?? k.usn,
            at: k.occurred_at ?? k.created_at,
            ai_assisted: Boolean(k.ai_assisted),
            files: [],
          }
          groups.set(key, g)
        }
        g.files.push({
          contribution_id: k.contribution_id,
          artifact_id: k.artifact.artifact_id,
          artifact_title: k.artifact.title,
          path: k.artifact.external_ref,
          artifact_type: k.artifact.type,
          contribution_type: k.contribution_type,
        })
      }
      return [...groups.values()].sort((a, b) => b.at.localeCompare(a.at))
    },
  })
}
