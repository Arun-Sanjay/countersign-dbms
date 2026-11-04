import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Small overline above the title, e.g. "P06 · CD252IA Lab 2026-27". */
  eyebrow?: ReactNode
  /** Buttons on the right. */
  actions?: ReactNode
  /** A row of chips/badges under the description. */
  meta?: ReactNode
  className?: string
}

export function PageHeader({ title, description, eyebrow, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</div>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
