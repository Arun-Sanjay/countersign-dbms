import { FileText, Loader2, MessageCircleQuestion, RotateCw, Search, SearchX, ShieldCheck, Sparkles, WifiOff, X } from 'lucide-react'
import { Fragment, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { SqlButton } from '@/components/sql/SqlButton'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  RRF_K,
  useAsk,
  useSearchChunks,
  useSearchScope,
  type AskCitation,
  type AskResponse,
  type SearchHit,
  type SearchParams,
} from '@/data/search'
import { API_START_HINT, API_URL, ApiError, isMissingEndpoint, isOffline } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const ANY = '__any'

/** ts_headline marks matches with **…** (StartSel/StopSel in search_chunks). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split('**')
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-pending-soft px-0.5 text-foreground ring-1 ring-pending/20">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

function rrfPart(rank: number | null): string {
  return rank === null ? '0' : (1 / (RRF_K + rank)).toFixed(4)
}

function flash(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-brand')
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-brand'), 1600)
}

const resultId = (chunkId: number) => `result-chunk-${chunkId}`
const citationId = (n: number) => `citation-${n}`

function ResultCard({ hit, rank, citedAs }: { hit: SearchHit; rank: number; citedAs: number[] }) {
  return (
    <li
      id={resultId(hit.chunk_id)}
      data-testid="search-result"
      data-chunk={hit.chunk_id}
      data-artifact={hit.artifact_id}
      className="scroll-mt-24 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-xs text-muted-foreground">#{rank}</span>
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{hit.artifact_title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {hit.artifact_id}@v{hit.version_no}
              {hit.chunk_no ? ` · chunk ${hit.chunk_no}` : ''}
            </span>
            {citedAs.map((n) => (
              <span key={n} className="rounded-full bg-brand-soft px-1.5 text-[11px] font-medium text-brand">
                cited [{n}]
              </span>
            ))}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {hit.author_name} <span className="font-mono">{hit.author_usn}</span>
            </span>
            <span>·</span>
            <span className="font-mono">{hit.team_id}</span>
            <span className="font-mono">{hit.project_id}</span>
            <span>·</span>
            <span>{hit.artifact_type}</span>
            <span>·</span>
            <time dateTime={hit.created_at}>{formatDate(hit.created_at)}</time>
          </p>
        </div>
        <StatusBadge status={hit.visibility} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-pretty" data-testid="search-snippet">
        <Highlighted text={hit.snippet} />
      </p>
      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-xs text-muted-foreground" data-testid="score-breakdown">
        <div className="flex gap-1">
          <dt>FTS rank</dt>
          <dd className="tabular font-medium text-foreground">{hit.rank_fts ?? '—'}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Vector rank</dt>
          <dd className="tabular font-medium text-foreground" title={hit.rank_vec === null ? 'no query embedding (keyword-only search)' : undefined}>
            {hit.rank_vec ?? '—'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>RRF</dt>
          <dd className="tabular font-mono text-foreground">
            {rrfPart(hit.rank_fts)} + {rrfPart(hit.rank_vec)} = <span className="font-semibold">{hit.score.toFixed(4)}</span>
          </dd>
        </div>
      </dl>
    </li>
  )
}

/** The answer text with [n] markers turned into links to the cited result card. */
function AnswerText({ text, citations, inResults }: { text: string; citations: AskCitation[]; inResults: Set<number> }) {
  const byN = new Map(citations.map((c) => [c.n, c]))
  const out: ReactNode[] = []
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index))
    const ns = m[1]!.split(',').map((x) => Number(x.trim()))
    out.push(
      <sup key={m.index} className="whitespace-nowrap">
        {ns.map((n) => {
          const c = byN.get(n)
          const target = c && inResults.has(c.chunk_id) ? resultId(c.chunk_id) : citationId(n)
          return (
            <a
              key={n}
              href={`#${target}`}
              data-testid="answer-citation"
              onClick={(e) => {
                e.preventDefault()
                flash(target)
              }}
              className="mx-px rounded px-0.5 font-mono text-[11px] font-semibold text-brand hover:bg-brand-soft"
            >
              [{n}]
            </a>
          )
        })}
      </sup>,
    )
    last = (m.index ?? 0) + m[0].length
  }
  out.push(text.slice(last))
  return <p className="text-sm leading-relaxed whitespace-pre-line text-pretty">{out}</p>
}

function AskAnswer({ data, inResults }: { data: AskResponse; inResults: Set<number> }) {
  return (
    <div className="space-y-3" data-testid="ask-answer">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
          <Sparkles className="size-3" aria-hidden />
          {data.mode === 'extractive' ? 'Extractive answer (no LLM key configured)' : `Generated${data.model ? ` · ${data.model}` : ''}`}
        </span>
        {data.retrieved !== null ? <span>{data.retrieved} chunks retrieved as you</span> : null}
        {data.cited_subset_of_retrieved === true ? (
          <span className="inline-flex items-center gap-1 text-confirmed">
            <ShieldCheck className="size-3.5" aria-hidden /> every citation was retrieved under your RLS
          </span>
        ) : null}
      </div>
      {data.answer.trim() ? (
        <AnswerText text={data.answer} citations={data.citations} inResults={inResults} />
      ) : (
        <p className="text-sm text-muted-foreground">No answer: nothing you can read matches the question.</p>
      )}
      {data.citations.length ? (
        <ol className="space-y-1.5 border-t pt-3 text-xs">
          {data.citations.map((c) => (
            <li key={`${c.n}-${c.chunk_id}`} id={citationId(c.n)} className="flex gap-2 rounded-md p-1 transition-shadow">
              <span className="font-mono font-semibold text-brand">[{c.n}]</span>
              <span className="min-w-0">
                <span className="font-medium">{c.artifact_title ?? `chunk ${c.chunk_id}`}</span>{' '}
                <span className="font-mono text-muted-foreground">
                  {c.artifact_id ? `${c.artifact_id}${c.version_no ? `@v${c.version_no}` : ''} · ` : ''}chunk_id {c.chunk_id}
                </span>
                {c.author_name || c.author_usn ? <span className="text-muted-foreground"> · {c.author_name ?? c.author_usn}</span> : null}
                {inResults.has(c.chunk_id) ? (
                  <button type="button" className="ml-2 text-brand hover:underline" onClick={() => flash(resultId(c.chunk_id))}>
                    show result
                  </button>
                ) : null}
                {c.snippet ? <span className="mt-0.5 block text-muted-foreground">“{c.snippet.replaceAll('**', '')}”</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function AskOffline({ onRetry, busy, missing }: { onRetry: () => void; busy: boolean; missing: boolean }) {
  return (
    <EmptyState
      compact
      icon={WifiOff}
      title={missing ? 'This API has no /ask endpoint yet' : 'Ask API offline'}
      description={
        <>
          {missing ? `The API at ${API_URL} answered, but not on POST /ask.` : `The API at ${API_URL} did not answer.`} Search
          above still works: it runs in Postgres. To start the API locally: <span className="font-mono text-xs">{API_START_HINT}</span>
        </>
      }
      action={
        <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
          <RotateCw className={cn(busy && 'animate-spin')} /> Try again
        </Button>
      }
    />
  )
}

/** /search — permission-aware retrieval (search_chunks) and cited answers (POST /ask). */
export default function SearchPage() {
  const profile = useProfile()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const team = params.get('team') ?? ''
  const author = params.get('author') ?? ''
  const since = params.get('since') ?? ''

  const [draft, setDraft] = useState(q)
  const [question, setQuestion] = useState('')
  const scope = useSearchScope()
  const teams = scope.data ?? []
  const people = (team ? teams.filter((t) => t.team_id === team) : teams).flatMap((t) => t.members)
  const authors = [...new Map(people.map((p) => [p.usn, p])).values()].sort((a, b) => a.name.localeCompare(b.name))

  const searchParams: SearchParams | null = q.trim()
    ? { query: q, teamId: team || undefined, authorUsn: author || undefined, since: since || undefined, limit: 20 }
    : null
  const results = useSearchChunks(searchParams)
  const ask = useAsk()
  const hits = results.data ?? []
  const inResults = new Set(hits.map((h) => h.chunk_id))
  const citedBy = new Map<number, number[]>()
  for (const c of ask.data?.citations ?? []) citedBy.set(c.chunk_id, [...(citedBy.get(c.chunk_id) ?? []), c.n])

  const update = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    update({ q: draft.trim() })
  }
  const askNow = () => {
    const text = question.trim()
    if (text.length < 3) return
    ask.mutate({ question: text, team_id: team || undefined, author_usn: author || undefined, since: since.slice(0, 10) || undefined })
    // show the retrieval behind the answer as result cards (same filters)
    if (!q.trim()) {
      setDraft(text)
      update({ q: text })
    }
  }
  const onAsk = (e: FormEvent) => {
    e.preventDefault()
    askNow()
  }

  const staff = profile.role !== 'student'
  const filtersActive = Boolean(team || author || since)

  return (
    <>
      <PageHeader
        eyebrow="Search"
        title="Search the record"
        description={
          staff
            ? 'Keyword and semantic search over artifact text, run as you. Faculty find only submitted text of the projects they teach: oversight never becomes reading drafts.'
            : 'Keyword and semantic search over your teams’ notes and reports, run as you. You never find a teammate’s private text, and nothing from teams you are not in.'
        }
      />

      <div className="space-y-4">
        <Panel contentClassName="space-y-4">
          <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row" aria-label="Search">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. weak entity, cardinality, normalization"
                aria-label="Search query"
                className="pl-9"
                data-testid="search-input"
              />
            </div>
            <Button type="submit" data-testid="search-submit" disabled={!draft.trim()}>
              <Search /> Search
            </Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="search-team">Team</Label>
              <Select value={team || ANY} onValueChange={(v) => update({ team: v === ANY ? '' : v, author: '' })}>
                <SelectTrigger id="search-team" className="w-full" aria-label="Team filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All teams you can see</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.team_id} value={t.team_id}>
                      <span className="font-mono text-xs">{t.team_id}</span> {t.team_name}
                      <span className="text-xs text-muted-foreground"> · {t.project_id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="search-author">Author</Label>
              <Select value={author || ANY} onValueChange={(v) => update({ author: v === ANY ? '' : v })}>
                <SelectTrigger id="search-author" className="w-full" aria-label="Author filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Anyone</SelectItem>
                  {authors.map((a) => (
                    <SelectItem key={a.usn} value={a.usn}>
                      {a.name} <span className="font-mono text-xs text-muted-foreground">{a.usn}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="search-since">Since</Label>
              <div className="flex gap-2">
                <Input id="search-since" type="date" value={since} onChange={(e) => update({ since: e.target.value })} aria-label="Since date" />
                {filtersActive ? (
                  <Button type="button" variant="ghost" size="icon" title="Clear filters" onClick={() => update({ team: '', author: '', since: '' })}>
                    <X />
                    <span className="sr-only">Clear filters</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <Panel
            title="Results"
            description={
              searchParams
                ? `Ranked by reciprocal rank fusion: score = Σ 1/(${RRF_K} + rank). Without a query embedding only the keyword list contributes.`
                : 'Type a query and press Search.'
            }
            actions={
              searchParams && results.isSuccess ? (
                <span className="tabular text-xs text-muted-foreground" data-testid="search-count">
                  {hits.length} {hits.length === 1 ? 'result' : 'results'}
                </span>
              ) : null
            }
            sqlId="search.chunks"
          >
            {!searchParams ? (
              <EmptyState compact icon={Search} title="Nothing searched yet" description="Results show the artifact, version, author and time of every matching chunk, with the matched words highlighted." />
            ) : results.isError ? (
              <ErrorState compact error={results.error} onRetry={() => void results.refetch()} />
            ) : results.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : hits.length === 0 ? (
              <EmptyState
                compact
                icon={SearchX}
                title="No results visible to you"
                description={
                  staff
                    ? 'Nothing submitted in the projects you teach matches. Team drafts and private text are never searchable by staff.'
                    : 'Nothing in your teams’ text matches. Other teams’ text and teammates’ private chunks are never searched.'
                }
              />
            ) : (
              <ol className="space-y-3" data-testid="search-results">
                {hits.map((h, i) => (
                  <ResultCard key={h.chunk_id} hit={h} rank={i + 1} citedAs={citedBy.get(h.chunk_id) ?? []} />
                ))}
              </ol>
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <MessageCircleQuestion className="size-4 text-muted-foreground" aria-hidden /> Ask
              </span>
            }
            description="An answer built only from chunks you can retrieve, each sentence cited."
            actions={<SqlButton panelId="search.ask" />}
            className="lg:sticky lg:top-4"
            contentClassName="space-y-3"
          >
            <form onSubmit={onAsk} className="space-y-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    askNow()
                  }
                }}
                placeholder="e.g. Why did we model the weak entity this way?"
                aria-label="Question"
                rows={3}
                data-testid="ask-input"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Uses the filters above (team, author, since). ⌘/Ctrl + Enter</span>
                <Button type="submit" size="sm" disabled={question.trim().length < 3 || ask.isPending} data-testid="ask-submit">
                  {ask.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Ask
                </Button>
              </div>
            </form>
            {ask.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : ask.isError ? (
              isOffline(ask.error) || isMissingEndpoint(ask.error) ? (
                <AskOffline onRetry={askNow} busy={ask.isPending} missing={isMissingEndpoint(ask.error)} />
              ) : ask.error instanceof ApiError ? (
                <ErrorState compact error={{ code: String(ask.error.status), details: ask.error.code, message: ask.error.message }} onRetry={askNow} />
              ) : (
                <ErrorState compact error={ask.error} onRetry={askNow} />
              )
            ) : ask.data ? (
              <AskAnswer data={ask.data} inResults={inResults} />
            ) : (
              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                The API retrieves with your own token (search_chunks under your RLS), so the same question gives a student, a teammate
                and a faculty member different sources. Citations link to the result cards.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
