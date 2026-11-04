import { AlertCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { errorTag, toAppError } from '@/lib/errors'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  compact?: boolean
  className?: string
}

/** A failed query, explained: friendly message + the SQLSTATE / rule key it came from. */
export function ErrorState({ error, onRetry, compact, className }: ErrorStateProps) {
  const e = toAppError(error)
  const tag = errorTag(e)
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 text-sm',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{e.title}</p>
        <p className="text-muted-foreground">{e.message}</p>
        {tag ? <p className="font-mono text-xs text-muted-foreground/80">{tag}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw />
          Retry
        </Button>
      ) : null}
    </div>
  )
}
