import { ChevronRight } from 'lucide-react'
import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import { PageSkeleton } from '@/components/Skeletons'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { usePageContext, useDocumentTitle } from '@/components/layout/usePageContext'
import { backendKind } from '@/lib/env'
import { cn } from '@/lib/utils'

function BackendChip() {
  return (
    <span
      title={backendKind === 'local' ? 'Connected to the local Supabase stack' : 'Connected to Supabase cloud'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        backendKind === 'local' ? 'bg-pending-soft text-pending ring-pending/25' : 'bg-confirmed-soft text-confirmed ring-confirmed/25',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {backendKind === 'local' ? 'Local' : 'Cloud'}
    </span>
  )
}

/** Top-bar breadcrumb for the current page: "Rubric sheet › P06 · CD252IA Lab 2026-27". */
function Breadcrumb() {
  const ctx = usePageContext()
  useDocumentTitle(ctx)
  if (!ctx) return <span className="truncate text-xs text-muted-foreground">Countersign</span>
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <li className="shrink-0 font-medium text-foreground">{ctx.page}</li>
        {ctx.projectId ? (
          <>
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <li className="truncate" title={ctx.projectTitle}>
              <span className="font-mono">{ctx.projectId}</span>
              {ctx.projectTitle ? ` · ${ctx.projectTitle}` : null}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  )
}

/** Signed-in chrome: role-aware sidebar + slim top bar + the routed page. */
export function AppShell() {
  const { pathname } = useLocation()
  // the marks sheet is a wide grid: give it the room a projector has
  const wide = pathname.startsWith('/sheet/')
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <Breadcrumb />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <BackendChip />
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cn('mx-auto w-full min-w-0 flex-1 px-4 py-8 outline-none sm:px-6 lg:px-8', wide ? 'max-w-[100rem]' : 'max-w-6xl')}
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
