/** Small building blocks shared by the student pages. */
import {
  CalendarClock,
  ExternalLink,
  FileCode2,
  FileText,
  GitCommitHorizontal,
  Layers,
  Link2,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CountersignRow, EvidenceRow } from '@/data/projects'
import { formatDate, formatDateTime } from '@/lib/format'
import type { EvidenceKind } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { EVIDENCE_LABEL } from './labels'
import { countdownLabel, countdownTone, daysUntil } from './time'

// ---- deadlines ---------------------------------------------------------------------------------
export function CountdownChip({ deadline, locked, className }: { deadline: string | null; locked?: boolean; className?: string }) {
  const days = daysUntil(deadline)
  const tone = locked ? 'none' : countdownTone(days)
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tone === 'soon' && 'bg-pending-soft text-pending ring-pending/25',
        tone === 'later' && 'bg-brand-soft text-brand ring-brand/20',
        (tone === 'past' || tone === 'none') && 'bg-muted text-muted-foreground ring-border',
        className,
      )}
      title={deadline ? formatDate(deadline) : undefined}
    >
      <CalendarClock className="size-3" aria-hidden />
      {countdownLabel(days)}
    </span>
  )
}

// ---- capacity ------------------------------------------------------------------------------------
export function CapacityBar({ members, max, className }: { members: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((members / max) * 100)) : 0
  const full = members >= max
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Capacity</span>
        <span className="tabular font-medium text-foreground">
          {members} / {max}
          {full ? ' · full' : ''}
        </span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden" aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={cn('h-full flex-1 rounded-full', i < members ? (full ? 'bg-muted-foreground/60' : 'bg-brand') : 'bg-muted')}
          />
        ))}
      </div>
      <span className="sr-only">
        {members} of {max} places taken ({pct}%)
      </span>
    </div>
  )
}

// ---- skill levels ----------------------------------------------------------------------------------
/** Five pips; `required` draws a marker at the required level. */
export function LevelPips({
  value,
  required,
  tone = 'brand',
  label,
}: {
  value: number | null
  required?: number
  tone?: 'brand' | 'confirmed' | 'muted'
  label: string
}) {
  const fill = tone === 'confirmed' ? 'bg-confirmed' : tone === 'muted' ? 'bg-muted-foreground/50' : 'bg-brand'
  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">
        {label}: {value ?? 'none'} of 5
      </span>
      {Array.from({ length: 5 }, (_, i) => {
        const level = i + 1
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              'size-2.5 rounded-[3px] ring-1 ring-inset',
              value !== null && level <= value ? `${fill} ring-transparent` : 'bg-background ring-border',
              required === level && 'outline-1 outline-offset-1 outline-foreground/60',
            )}
          />
        )
      })}
    </span>
  )
}

// ---- AI assistance (declared, never detected): shared with the faculty pages
export { AiBadge } from '@/components/AiBadge'

// ---- claim status counts -------------------------------------------------------------------------------
export function ClaimCounts({
  pending,
  confirmed,
  contested,
  showEmpty = true,
  hasEvidence,
}: {
  pending: number
  confirmed: number
  contested: number
  showEmpty?: boolean
  /** recorded work (contributions / versions) exists: zero claims then means "no claims filed",
   *  not "no recorded evidence". undefined = unknown, treated as no evidence. */
  hasEvidence?: boolean
}) {
  if (pending + confirmed + contested === 0) {
    return showEmpty ? <StatusBadge status={hasEvidence ? 'no_claims' : 'no_evidence'} /> : null
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {confirmed > 0 ? <StatusBadge status="confirmed" label={`${confirmed} confirmed`} plain /> : null}
      {pending > 0 ? <StatusBadge status="pending" label={`${pending} pending`} plain /> : null}
      {contested > 0 ? <StatusBadge status="contested" label={`${contested} contested`} plain /> : null}
    </span>
  )
}

// ---- evidence ---------------------------------------------------------------------------------------------
const EVIDENCE_ICON: Record<EvidenceKind, LucideIcon> = {
  contribution: Layers,
  artifact_version: FileText,
  commit: GitCommitHorizontal,
  url: Link2,
  file: FileCode2,
}

export interface EvidenceLookups {
  artifactTitle?: (artifactId: string) => string | undefined
  contribution?: (id: number) => string | undefined
}

export function EvidenceList({ evidence, lookups }: { evidence: EvidenceRow[]; lookups?: EvidenceLookups }) {
  if (evidence.length === 0) {
    return (
      <p className="text-xs font-medium text-contested">
        No receipt attached yet: teammates and faculty will see this claim has no evidence. Add some.
      </p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {evidence.map((e) => {
        const Icon = EVIDENCE_ICON[e.kind]
        let main: ReactNode
        if (e.kind === 'contribution' && e.contribution_id !== null) {
          const desc = lookups?.contribution?.(e.contribution_id)
          main = (
            <>
              <span className="font-mono">#{e.contribution_id}</span>
              {desc ? <span className="text-muted-foreground"> · {desc}</span> : null}
            </>
          )
        } else if (e.kind === 'artifact_version' && e.artifact_id) {
          const title = lookups?.artifactTitle?.(e.artifact_id)
          main = (
            <>
              <span className="font-mono">
                {e.artifact_id}@v{e.version_no}
              </span>
              {title ? <span className="text-muted-foreground"> · {title}</span> : null}
            </>
          )
        } else if (e.kind === 'url' && e.ref) {
          // claim_evidence_ref_format guarantees http(s):// here, so the link is safe to render
          main = (
            <a href={e.ref} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-brand hover:underline">
              {e.ref}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )
        } else {
          main = <span className="font-mono break-all">{e.kind === 'commit' ? e.ref?.slice(0, 10) : e.ref}</span>
        }
        return (
          <li key={e.evidence_no} className="flex items-start gap-2 text-xs">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="min-w-0 leading-5">
              <span className="text-muted-foreground">{EVIDENCE_LABEL[e.kind]} </span>
              {main}
              {e.note ? <span className="text-muted-foreground italic"> — {e.note}</span> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---- countersigns --------------------------------------------------------------------------------------------
export function CountersignList({ countersigns, currentRevision }: { countersigns: CountersignRow[]; currentRevision: number }) {
  if (countersigns.length === 0) {
    return <p className="text-xs text-muted-foreground">No teammate has countersigned yet.</p>
  }
  return (
    <ul className="space-y-1.5">
      {countersigns.map((s) => {
        const confirm = s.verdict === 'confirm'
        const Icon = confirm ? ThumbsUp : ThumbsDown
        return (
          <li key={s.endorser_usn} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                'mt-px flex size-5 shrink-0 items-center justify-center rounded-md',
                confirm ? 'bg-confirmed-soft text-confirmed' : 'bg-contested-soft text-contested',
              )}
            >
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="min-w-0 leading-5">
              <span className="font-medium">{s.endorser_name}</span>{' '}
              <span className="text-muted-foreground">
                {confirm ? 'confirmed' : 'disputed'} revision {s.claim_revision} · {formatDateTime(s.signed_at)}
              </span>
              {s.claim_revision !== currentRevision ? (
                <span className="ml-1 text-pending">(the claim has changed since)</span>
              ) : null}
              {s.comment ? <p className="text-foreground/80">“{s.comment}”</p> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---- project picker --------------------------------------------------------------------------------------------
export interface PickerProject {
  project_id: string
  title: string
  course_code: string
  current: boolean
  team_id?: string | null
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  className,
}: {
  projects: PickerProject[]
  value: string | undefined
  onChange: (projectId: string) => void
  className?: string
}) {
  const current = projects.filter((p) => p.current)
  const earlier = projects.filter((p) => !p.current)
  const item = (p: PickerProject) => (
    <SelectItem key={p.project_id} value={p.project_id}>
      <span className="font-mono text-xs text-muted-foreground">{p.project_id}</span>
      <span>{p.title}</span>
      <span className="text-xs text-muted-foreground">· {p.course_code}</span>
    </SelectItem>
  )
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full sm:w-80', className)} aria-label="Project">
        <SelectValue placeholder="Choose a project" />
      </SelectTrigger>
      <SelectContent>
        {current.length ? (
          <SelectGroup>
            <SelectLabel>This term</SelectLabel>
            {current.map(item)}
          </SelectGroup>
        ) : null}
        {earlier.length ? (
          <SelectGroup>
            <SelectLabel>Earlier terms</SelectLabel>
            {earlier.map(item)}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  )
}

/** A mono formula block (relational algebra shown next to the result). */
export function Formula({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90', className)}>
      {children}
    </div>
  )
}
