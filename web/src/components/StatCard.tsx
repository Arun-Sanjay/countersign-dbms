import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'brand' | 'pending' | 'confirmed' | 'contested'

const TONES: Record<Tone, string> = {
  default: 'text-muted-foreground bg-muted',
  brand: 'text-brand bg-brand-soft',
  pending: 'text-pending bg-pending-soft',
  confirmed: 'text-confirmed bg-confirmed-soft',
  contested: 'text-contested bg-contested-soft',
}

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Secondary line: "of 120 raw", "2 due this week". */
  hint?: ReactNode
  icon?: LucideIcon
  tone?: Tone
  loading?: boolean
  className?: string
  /** Optional trailing slot (e.g. a SQL button or link). */
  aside?: ReactNode
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', loading, className, aside }: StatCardProps) {
  return (
    <div className={cn('relative flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? (
          <span className={cn('flex size-7 items-center justify-center rounded-md', TONES[tone])}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : (
          aside
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : (
        <div className="space-y-0.5">
          <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      )}
    </div>
  )
}
