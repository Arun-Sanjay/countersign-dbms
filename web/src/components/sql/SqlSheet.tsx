import { ChevronRight, Database, FileCode2, ShieldCheck, Sigma, Workflow, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { SqlCode } from '@/components/sql/SqlCode'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { getSqlPanel, policySql, triggerSql, UNIT_TITLES, type SqlPanelId } from '@/sql/registry'

interface SqlSheetProps {
  panelId: SqlPanelId
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Expandable({ title, meta, children, defaultOpen }: { title: ReactNode; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg ring-1 ring-foreground/10">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{title}</span>
        {meta}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function Comment({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {text.replace(/^\s*-- ?/gm, '')}
    </p>
  )
}

/** The "Show the SQL" side sheet for one data panel. */
export function SqlSheet({ panelId, open, onOpenChange }: SqlSheetProps) {
  const p = getSqlPanel(panelId)
  const triggers = p.triggers ?? []
  const related = p.related ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:xl:max-w-[60vw]">
        <SheetHeader className="gap-2 border-b p-5 pr-12">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <FileCode2 className="size-3.5" /> Show the SQL
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight">{p.title}</SheetTitle>
          <SheetDescription className="text-pretty">{p.summary}</SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline" className="font-mono text-[11px] font-normal">
              {p.origin === 'migration' ? `supabase/migrations/${p.file ?? ''}` : 'supabase-js → PostgREST, as you'}
            </Badge>
            {[...new Set(p.concepts.map((c) => c.unit))].map((unit) => (
              <Badge key={unit} variant="secondary" className="font-normal">
                Unit {unit}
              </Badge>
            ))}
          </div>
        </SheetHeader>

        <Tabs defaultValue="sql" className="min-h-0 min-w-0 flex-1 gap-0">
          <div className="border-b px-5 py-2">
            <TabsList variant="line">
              <TabsTrigger value="sql">
                <Database /> SQL
              </TabsTrigger>
              {p.algebra ? (
                <TabsTrigger value="algebra">
                  <Sigma /> Algebra
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="rls">
                <ShieldCheck /> RLS <span className="tabular text-muted-foreground">{p.rls.length}</span>
              </TabsTrigger>
              {triggers.length ? (
                <TabsTrigger value="triggers">
                  <Zap /> Triggers <span className="tabular text-muted-foreground">{triggers.length}</span>
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="concepts">
                <Workflow /> Concepts
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <TabsContent value="sql" className="space-y-4 p-5">
              <Comment text={p.comment} />
              <SqlCode code={p.sql} />
              {related.length ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Also runs</h3>
                  {related.map((r) => (
                    <Expandable key={r.label} title={r.label} meta={<span className="text-xs text-muted-foreground">{r.file}</span>}>
                      <div className="space-y-2 pt-1">
                        <Comment text={r.comment} />
                        <SqlCode code={r.sql} />
                      </div>
                    </Expandable>
                  ))}
                </div>
              ) : null}
            </TabsContent>

            {p.algebra ? (
              <TabsContent value="algebra" className="space-y-3 p-5">
                <div className="rounded-lg bg-muted/40 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap ring-1 ring-foreground/10">
                  {p.algebra}
                </div>
                <p className="text-xs text-muted-foreground">
                  σ select · π project · ⋈ join · ⟕ left outer join · ▷ anti-join · ∪ union · − difference · ÷ division · γ group/aggregate
                </p>
              </TabsContent>
            ) : null}

            <TabsContent value="rls" className="space-y-2 p-5">
              <p className="pb-1 text-sm text-muted-foreground">
                {p.rls.length
                  ? 'These policies filter or gate the rows. They run as you: the query cannot see past them.'
                  : 'No row-level policy applies here.'}
              </p>
              {p.note ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{p.note}</p>
              ) : null}
              {p.rls.map((name) => {
                const pol = policySql(name)
                return (
                  <Expandable
                    key={name}
                    title={name}
                    meta={
                      <span className="flex items-center gap-1.5">
                        {pol.generated ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            generated
                          </Badge>
                        ) : null}
                        <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                          {pol.table}
                        </Badge>
                      </span>
                    }
                  >
                    <SqlCode code={pol.sql} lineNumbers={false} className="mt-1" />
                  </Expandable>
                )
              })}
            </TabsContent>

            {triggers.length ? (
              <TabsContent value="triggers" className="space-y-2 p-5">
                <p className="pb-1 text-sm text-muted-foreground">
                  Integrity rules a CHECK cannot express. They are SECURITY DEFINER, so they hold even when you cannot see the
                  rows they check.
                </p>
                {triggers.map((name) => {
                  const t = triggerSql(name)
                  return (
                    <Expandable
                      key={name}
                      title={name}
                      meta={
                        <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                          {t.table}
                        </Badge>
                      }
                    >
                      <div className="space-y-2 pt-1">
                        <SqlCode code={t.sql} lineNumbers={false} />
                        {t.fnSql ? <SqlCode code={t.fnSql} /> : null}
                      </div>
                    </Expandable>
                  )
                })}
              </TabsContent>
            ) : null}

            <TabsContent value="concepts" className="space-y-3 p-5">
              {p.concepts.map((c) => (
                <div key={c.unit + c.topic} className="flex gap-3 rounded-lg p-3 ring-1 ring-foreground/10">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft font-mono text-sm font-semibold text-brand">
                    {c.unit}
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">
                      Unit {c.unit} · {UNIT_TITLES[c.unit]}
                    </div>
                    <div className="text-sm font-medium">{c.topic}</div>
                  </div>
                </div>
              ))}
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
