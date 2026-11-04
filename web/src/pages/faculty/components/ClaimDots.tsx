import { CircleCheck, Clock3, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { claimSummary } from './claimSummary'
import { LOCKED_HATCH } from './styles'

interface ClaimDotsProps {
  confirmed: number
  pending: number
  contested: number
  className?: string
}

const GLYPHS: Record<'confirmed' | 'pending' | 'contested', { icon: LucideIcon; tone: string; label: string }> = {
  contested: { icon: TriangleAlert, tone: 'text-contested', label: 'contested' },
  pending: { icon: Clock3, tone: 'text-pending', label: 'pending' },
  confirmed: { icon: CircleCheck, tone: 'text-confirmed', label: 'confirmed' },
}

/**
 * Claim-status glyphs for a rubric cell: a distinct shape per status (check, clock,
 * warning triangle) plus a count, so the meaning never rests on colour alone.
 * No claims renders nothing; the cell itself shows "no claim" when it has a mark.
 */
export function ClaimDots({ confirmed, pending, contested, className }: ClaimDotsProps) {
  const counts = { contested, pending, confirmed }
  if (confirmed + pending + contested === 0) return null
  const label = claimSummary(confirmed, pending, contested)
  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={label[0]!.toUpperCase() + label.slice(1)}>
      <span className="sr-only">{label}</span>
      {(Object.keys(GLYPHS) as (keyof typeof GLYPHS)[])
        .filter((k) => counts[k] > 0)
        .map((k) => {
          const g = GLYPHS[k]
          return (
            <span key={k} className={cn('inline-flex items-center gap-px text-[10px] leading-none font-semibold', g.tone)} aria-hidden>
              <g.icon className="size-3" strokeWidth={2.5} />
              {counts[k] > 1 ? <span className="tabular">{counts[k]}</span> : null}
            </span>
          )
        })}
    </span>
  )
}

/** The legend shown above the sheet. */
export function ClaimDotsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(['confirmed', 'pending', 'contested'] as const).map((k) => {
        const g = GLYPHS[k]
        return (
          <span key={k} className="inline-flex items-center gap-1.5">
            <g.icon className={cn('size-3.5', g.tone)} strokeWidth={2.5} aria-hidden />
            {k === 'pending' ? 'pending countersign' : `${g.label} claim`}
          </span>
        )
      })}
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-sm px-1 text-[10px] leading-4 font-medium text-contested ring-1 ring-contested/60 ring-inset">
          no claim
        </span>
        a mark with no claim behind it
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm bg-muted/70 ring-1 ring-foreground/10" style={LOCKED_HATCH} />
        locked (marks final)
      </span>
    </div>
  )
}
