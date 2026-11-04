import { CodeXml } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SqlPanelId } from '@/sql/registry'

// The sheet (and the SQL text + highlighter) loads on first open, off the critical path.
const SqlSheet = lazy(() => import('@/components/sql/SqlSheet').then((m) => ({ default: m.SqlSheet })))

interface SqlButtonProps {
  panelId: SqlPanelId
  /** 'floating' pins it to the top-right corner of a relative parent. */
  variant?: 'floating' | 'inline'
  className?: string
}

/** The "</> SQL" pill: opens the Show-the-SQL sheet for this panel. */
export function SqlButton({ panelId, variant = 'inline', className }: SqlButtonProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-sql-panel={panelId}
            onClick={() => {
              setMounted(true)
              setOpen(true)
            }}
            className={cn(
              'gap-1 rounded-full font-mono text-[11px] text-muted-foreground shadow-xs hover:text-brand',
              variant === 'floating' && 'absolute top-3 right-3 z-10',
              className,
            )}
            aria-label="Show the SQL"
          >
            <CodeXml className="size-3" />
            SQL
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show the SQL, algebra and RLS behind this panel</TooltipContent>
      </Tooltip>
      {mounted ? (
        <Suspense fallback={null}>
          <SqlSheet panelId={panelId} open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  )
}
