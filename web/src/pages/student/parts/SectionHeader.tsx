import type { ReactNode } from 'react'
import { SqlButton } from '@/components/sql/SqlButton'
import { cn } from '@/lib/utils'
import type { SqlPanelId } from '@/sql/registry'

/** A heading for a group of cards that together form one data panel (with its SQL pill). */
export function SectionHeader({
  title,
  description,
  sqlId,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  sqlId?: SqlPanelId
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3 pb-3', className)}>
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {sqlId ? <SqlButton panelId={sqlId} /> : null}
      </div>
    </div>
  )
}
