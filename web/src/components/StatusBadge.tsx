import { CircleCheck, CircleDashed, CircleSlash, Clock3, EyeOff, FileQuestion, Lock, Send, TriangleAlert, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Claim states (claim.status + a UI-only "withdrawn"), submission/lock states, the three
 * privacy tiers (artifact.visibility), and "no recorded evidence yet".
 */
export type Status =
  | 'pending'
  | 'confirmed'
  | 'contested'
  | 'withdrawn'
  | 'submitted'
  | 'locked'
  | 'open'
  | 'private'
  | 'team'
  | 'no_evidence'
  | 'no_claims'

const STYLES: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: 'Pending', icon: Clock3, className: 'bg-pending-soft text-pending ring-pending/25' },
  confirmed: { label: 'Confirmed', icon: CircleCheck, className: 'bg-confirmed-soft text-confirmed ring-confirmed/25' },
  contested: { label: 'Contested', icon: TriangleAlert, className: 'bg-contested-soft text-contested ring-contested/25' },
  withdrawn: { label: 'Withdrawn', icon: CircleSlash, className: 'bg-muted text-muted-foreground ring-border line-through decoration-1' },
  submitted: { label: 'Submitted', icon: Send, className: 'bg-info-soft text-info ring-info/25' },
  locked: { label: 'Locked', icon: Lock, className: 'bg-secondary text-secondary-foreground ring-border' },
  open: { label: 'Open', icon: CircleDashed, className: 'bg-background text-muted-foreground ring-border' },
  private: { label: 'Private', icon: EyeOff, className: 'bg-muted text-muted-foreground ring-border' },
  team: { label: 'Team', icon: Users, className: 'bg-brand-soft text-brand ring-brand/20' },
  no_evidence: {
    label: 'No recorded evidence yet',
    icon: CircleDashed,
    className: 'bg-background text-muted-foreground ring-border border-dashed',
  },
  // work is on record (contributions / versions) but nothing has been claimed from it
  no_claims: {
    label: 'No claims filed yet',
    icon: FileQuestion,
    className: 'bg-background text-muted-foreground ring-border',
  },
}

interface StatusBadgeProps {
  status: Status | (string & {})
  /** Override the label (e.g. "Contested · 1 dispute"). */
  label?: string
  /** Show only the dot + label, no icon. */
  plain?: boolean
  className?: string
}

export function StatusBadge({ status, label, plain, className }: StatusBadgeProps) {
  const style = STYLES[status as Status] ?? {
    label: status,
    icon: CircleDashed,
    className: 'bg-muted text-muted-foreground ring-border',
  }
  const Icon = style.icon
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        style.className,
        className,
      )}
    >
      {plain ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : <Icon className="size-3" aria-hidden />}
      {label ?? style.label}
    </span>
  )
}
