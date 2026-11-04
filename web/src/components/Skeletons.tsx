import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  )
}

export function PanelSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-xl p-5 ring-1 ring-foreground/10', className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <StatGridSkeleton />
      <PanelSkeleton />
    </div>
  )
}

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-brand" />
        {label}
      </div>
    </div>
  )
}
