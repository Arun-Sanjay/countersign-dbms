import type { ReactNode } from 'react'
import { SqlButton } from '@/components/sql/SqlButton'
import { cn } from '@/lib/utils'
import type { SqlPanelId } from '@/sql/registry'

interface PanelProps {
  title?: ReactNode
  description?: ReactNode
  /** Header-right controls (filters, buttons). The SQL pill sits after them. */
  actions?: ReactNode
  /** Registry id: shows the floating "</> SQL" button for this panel. */
  sqlId?: SqlPanelId
  children: ReactNode
  className?: string
  contentClassName?: string
  /** No inner padding (for edge-to-edge tables). */
  flush?: boolean
  /** A quiet line under the content (e.g. a "show more" toggle). */
  footer?: ReactNode
}

/** A data panel: a quiet card with an optional title and the Show-the-SQL button. */
export function Panel({ title, description, actions, sqlId, children, className, contentClassName, flush, footer }: PanelProps) {
  const hasHeader = Boolean(title || description || actions)
  return (
    <section className={cn('relative rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10', className)}>
      {hasHeader ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0 space-y-0.5">
            {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {sqlId ? <SqlButton panelId={sqlId} /> : null}
          </div>
        </div>
      ) : sqlId ? (
        <SqlButton panelId={sqlId} variant="floating" />
      ) : null}
      <div className={cn(flush ? '' : 'px-5 pb-5', !hasHeader && !flush && 'pt-5', contentClassName)}>{children}</div>
      {footer ? <div className="border-t px-5 py-2.5">{footer}</div> : null}
    </section>
  )
}
