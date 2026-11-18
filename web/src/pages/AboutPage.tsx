import {
  ArrowRight,
  ClipboardList,
  EyeOff,
  FileCheck2,
  MessageSquareQuote,
  Send,
  Signature,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { SqlButton } from '@/components/sql/SqlButton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SQL_PANELS, UNIT_TITLES, type SqlPanelId, type Unit } from '@/sql/registry'
import { POLICY_SQL } from '@/sql/sources.generated'

const CHAIN: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardList,
    title: 'Rubric cell',
    body: 'One mark for one student on one lab component (C1–C11), exactly as on the paper sheet.',
  },
  {
    icon: MessageSquareQuote,
    title: 'Claim',
    body: '“I did X for this component.” Filed by the student, with AI assistance declared, never detected.',
  },
  {
    icon: FileCheck2,
    title: 'Evidence',
    body: 'Pointers to real work: a contribution, an artifact version, a commit, a URL or a file.',
  },
  {
    icon: Signature,
    title: 'Countersign',
    body: 'A teammate confirms or disputes, against the exact revision they read. A dispute needs a reason. In a solo team there is no teammate to countersign: the claim rests on its evidence and faculty review.',
  },
]

const TIERS: { icon: LucideIcon; name: string; who: string; body: string }[] = [
  { icon: EyeOff, name: 'Private', who: 'Only you', body: 'Drafts and notes. Never shown to teammates or faculty.' },
  { icon: Users, name: 'Team', who: 'Your team', body: 'Shared work in progress. Faculty see counts and timestamps only.' },
  { icon: Send, name: 'Submitted', who: 'Team + teaching faculty', body: 'Frozen at submission; the faculty who teach the project can read it.' },
]

const UNITS: { unit: Unit; where: string[] }[] = [
  {
    unit: 'I',
    where: [
      'Three-schema architecture: role views are external schemas; private notes sit in an internal schema the API never exposes',
      'Weak entities: MILESTONE, ARTIFACT_VERSION, CLAIM_EVIDENCE',
      'Recursive relationship: skill → parent skill',
    ],
  },
  {
    unit: 'II',
    where: [
      'Teammate finder: StudentSkill ÷ (Required − Mine)',
      'Skill gap: Required − Mine (set difference)',
      'Who built what: Student ⋈ Contribution ⋈ Artifact',
      'RESTRICT vs CASCADE: history is never deleted silently',
    ],
  },
  {
    unit: 'III',
    where: [
      'The paper marks sheet normalized to BCNF and rebuilt as the v_rubric_sheet view',
      'CHECK constraints, triggers for cross-table rules, WITH RECURSIVE, aggregate FILTER',
      'Lab CIE /50 derived in a view, never stored',
      'Strict marks: a mark above the maximum or with a second decimal is refused on every path, never rounded',
    ],
  },
  {
    unit: 'IV',
    where: [
      'Atomic submit_milestone (one transaction freezes versions)',
      'Team capacity v2: serialize by writing the parent row (the RR over-admission finding)',
      'Race arena: six capacity strategies raced at the three isolation levels, with precedence graphs and the verbatim SQL',
      'Optimistic concurrency: a countersign binds to the claim revision it read',
    ],
  },
  {
    unit: 'V',
    where: [
      'MongoDB documents for notes and their immutable versions',
      'Portfolio aggregates via the aggregation pipeline',
    ],
  },
]

function SectionTitle({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl space-y-1.5 pb-5">
      <div className="text-xs font-medium tracking-wide text-brand uppercase">{kicker}</div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children ? <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{children}</p> : null}
    </div>
  )
}

/** /about — the thesis, how data flows, and where each DBMS unit lives. */
export default function AboutPage() {
  return (
    <div className="space-y-16">
      <PageHeader
        eyebrow="How Countersign works"
        title="Every mark has a receipt"
        description="A database-driven experiential-learning platform for RVCE CD252IA. The lab rubric is the schema: every mark traces back to claims, evidence and teammates' countersigns."
      />

      <blockquote className="-mt-10 max-w-2xl border-l-2 border-brand pl-4 text-lg leading-relaxed font-medium tracking-tight text-pretty">
        We don&apos;t detect AI. We make every mark traceable and every claim defensible.
      </blockquote>

      <section>
        <SectionTitle kicker="The chain" title="From a mark to the work behind it">
          Faculty used to sign the paper sheet on trust. Here each cell opens onto the claims behind it.
        </SectionTitle>
        <ol className="grid gap-3 md:grid-cols-4">
          {CHAIN.map((step, i) => (
            <li key={step.title} className="relative rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-md bg-brand-soft text-brand">
                  <step.icon className="size-4" />
                </span>
                <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="pt-3 text-sm font-semibold">{step.title}</h3>
              <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              {i < CHAIN.length - 1 ? (
                <ArrowRight className="absolute top-1/2 -right-2.5 hidden size-4 -translate-y-1/2 text-muted-foreground/60 md:block" />
              ) : null}
            </li>
          ))}
        </ol>
        <p className="pt-4 text-sm text-muted-foreground">
          A student with nothing claimed yet shows as <span className="font-medium text-foreground">“no recorded evidence yet”</span>:
          an invitation to file a claim, never a verdict.
        </p>
      </section>

      <section>
        <SectionTitle kicker="Privacy" title="Three tiers, enforced by the database">
          Visibility is a column, and row-level security reads it on every query. Students can check the promise on the
          “What my faculty sees” page.
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-center gap-2">
                <t.icon className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t.who}</span>
              </div>
              <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle kicker="Data flow" title="From a commit to a cell on the sheet">
          Raw events land in an append-only MongoDB log; Postgres keeps an idempotent projection of them; row-level security
          decides who sees which rows; the browser queries as the signed-in user, with no service key anywhere.
        </SectionTitle>
        <DataFlowDiagram />
      </section>

      <section>
        <SectionTitle kicker="Syllabus map" title="Units I–V, and the features that demonstrate them">
          Built from the same registry as the <span className="font-mono">&lt;/&gt; SQL</span> buttons, so it lists every data
          panel in the app. Each row opens its verbatim SQL, the relational algebra and the RLS policies that apply.
        </SectionTitle>
        <UnitsMap />
      </section>

      <section className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Non-goals.</span> No AI-writing detection (unreliable, and biased against
        non-native writers), no contribution leaderboards for faculty, no line-count metrics. The unit of contribution is the
        claim; commits and versions are its evidence.
      </section>
    </div>
  )
}

// ---- data flow ------------------------------------------------------------------------------------

interface FlowBox {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines: string[]
  /** dashed outline: not part of this prototype (every source below is live) */
  planned?: boolean
  tone?: 'brand' | 'default'
}

const COL_W = 172
const GAP = 48
const colX = (i: number) => 8 + i * (COL_W + GAP)

const STAGES = ['1 · Sources', '2 · Raw log · MongoDB', '3 · Projection · PostgreSQL', '4 · Access · RLS', '5 · UI']

const SOURCES: FlowBox[] = [
  { x: colX(0), y: 40, w: COL_W, h: 62, title: 'GitHub', lines: ['push webhook', 'commit SHA + author'] },
  { x: colX(0), y: 114, w: COL_W, h: 62, title: 'Obsidian', lines: ['vault notes', 'pushed with the repo'] },
  { x: colX(0), y: 188, w: COL_W, h: 62, title: 'In-app editor', lines: ['versioned saves', 'POST /notes (API)'] },
]

function boxesFor(policies: number): FlowBox[] {
  return [
    {
      x: colX(1),
      y: 40,
      w: COL_W,
      h: 210,
      title: 'elp (append-only)',
      lines: ['github_events', '  _id = delivery_id', 'notes', 'note_versions', '  one receipt per save', '  author · sha256 · time'],
    },
    {
      x: colX(2),
      y: 40,
      w: COL_W,
      h: 210,
      title: 'Relational projection',
      lines: ['contribution', '  UNIQUE (source,', '   source_ref, usn,', '   artifact_id)', '  ON CONFLICT DO NOTHING', 'artifact_version', '  mongo_ref, sha256', 'claim → claim_evidence'],
    },
    {
      x: colX(3),
      y: 40,
      w: COL_W,
      h: 210,
      title: 'Who sees which rows',
      lines: [`${policies} RLS policies`, '  default deny', 'security_invoker views', '  v_rubric_sheet', '  v_lab_cie_marks', '  v_contested_claims', '  v_what_faculty_sees', 'integrity triggers'],
    },
    {
      x: colX(4),
      y: 40,
      w: COL_W,
      h: 210,
      title: 'Countersign web',
      lines: ['React + supabase-js', 'publishable key', '  + your JWT', 'same SQL,', '  different rows', '  per signed-in user'],
      tone: 'brand',
    },
  ]
}

function Box({ b }: { b: FlowBox }) {
  return (
    <g>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={10}
        className={cn(b.tone === 'brand' ? 'fill-brand-soft stroke-brand/40' : 'fill-card stroke-foreground/15')}
        strokeWidth={1}
        strokeDasharray={b.planned ? '5 4' : undefined}
      />
      <text x={b.x + 12} y={b.y + 22} className="fill-foreground text-[14px] font-semibold">
        {b.title}
      </text>
      {b.lines.map((l, i) => (
        <text key={l + i} x={b.x + 12} y={b.y + 42 + i * 18} className="fill-muted-foreground font-mono text-[11.5px]" xmlSpace="preserve">
          {l}
        </text>
      ))}
    </g>
  )
}

function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g className="text-muted-foreground">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} strokeDasharray={dashed ? '4 4' : undefined} markerEnd="url(#flow-arrow)" />
      {label ? (
        <text x={lx} y={ly} textAnchor="middle" className="fill-muted-foreground text-[11.5px]">
          {label}
        </text>
      ) : null}
    </g>
  )
}

/** GitHub / Obsidian -> Mongo log -> Postgres projection -> RLS views -> UI, as one SVG. */
function DataFlowDiagram() {
  const boxes = boxesFor(Object.keys(POLICY_SQL).length)
  const midY = 145
  const right = (i: number) => colX(i) + COL_W
  return (
    <figure className="space-y-3">
      <div className="overflow-x-auto rounded-xl bg-muted/30 p-4 ring-1 ring-foreground/10">
        <svg
          viewBox="0 0 1080 330"
          aria-labelledby="flow-title flow-desc"
          className="mx-auto block w-full min-w-[1000px]"
        >
          <title id="flow-title">Countersign data flow</title>
          <desc id="flow-desc">
            GitHub and Obsidian events and in-app note saves are written to an append-only MongoDB log; a projection writes
            idempotent rows into PostgreSQL; row-level security policies and security_invoker views decide which rows each
            user sees; the web UI queries as the signed-in user. A consistency check compares MongoDB and PostgreSQL.
          </desc>
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>

          {STAGES.map((s, i) => (
            <text key={s} x={colX(i)} y={22} className="fill-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {s}
            </text>
          ))}

          {SOURCES.map((b) => (
            <Box key={b.title} b={b} />
          ))}
          {boxes.map((b) => (
            <Box key={b.title} b={b} />
          ))}

          {/* sources -> mongo */}
          {SOURCES.map((b) => (
            <Arrow
              key={b.title}
              d={`M${right(0) + 2},${b.y + b.h / 2} C${right(0) + 26},${b.y + b.h / 2} ${colX(1) - 26},${midY} ${colX(1) - 3},${midY}`}
              dashed={b.planned}
            />
          ))}
          <Arrow d={`M${right(1) + 2},${midY} L${colX(2) - 3},${midY}`} label="project" lx={(right(1) + colX(2)) / 2} ly={midY - 8} />
          <Arrow d={`M${right(2) + 2},${midY} L${colX(3) - 3},${midY}`} label="filter" lx={(right(2) + colX(3)) / 2} ly={midY - 8} />
          <Arrow d={`M${right(3) + 2},${midY} L${colX(4) - 3},${midY}`} label="as you" lx={(right(3) + colX(4)) / 2} ly={midY - 8} />

          {/* consistency loop: Postgres <-> Mongo */}
          <Arrow
            d={`M${colX(2) + COL_W / 2},252 C${colX(2) + COL_W / 2},300 ${colX(1) + COL_W / 2},300 ${colX(1) + COL_W / 2},254`}
            dashed
          />
          <text x={(colX(1) + right(2)) / 2} y={318} textAnchor="middle" className="fill-muted-foreground text-[11.5px]">
            GET /consistency: Mongo commits vs Postgres contributions, per team
          </text>
          <text x={colX(3) + 4} y={290} className="fill-muted-foreground text-[11.5px]">
            Views run as the caller (security_invoker),
          </text>
          <text x={colX(3) + 4} y={305} className="fill-muted-foreground text-[11.5px]">
            so the same view returns different rows to Arun,
          </text>
          <text x={colX(3) + 4} y={320} className="fill-muted-foreground text-[11.5px]">
            Meera and their faculty.
          </text>
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-foreground/30 bg-card" /> live in this prototype
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-5 border-t border-dashed border-foreground/40" /> consistency check (read-only); the GitHub
          webhook, the Mongo log and the projection worker are all live
        </span>
      </figcaption>
    </figure>
  )
}

// ---- units map --------------------------------------------------------------------------------------

const AREA_LABEL: Record<string, string> = {
  hub: 'Semester hub',
  team: 'Team & skills',
  project: 'Project page',
  notes: 'Private notes',
  faculty_view: 'What my faculty sees',
  faculty: 'Faculty',
  admin: 'Admin',
}

interface UnitRow {
  panelId: SqlPanelId
  feature: string
  area: string
  topic: string
}

interface TopicRow {
  topic: string
  features: UnitRow[]
}

/** Per unit: one row per syllabus topic, with every feature that demonstrates it (no repeats). */
function unitRows(): Record<Unit, TopicRow[]> {
  const out: Record<Unit, TopicRow[]> = { I: [], II: [], III: [], IV: [], V: [] }
  for (const [id, p] of Object.entries(SQL_PANELS) as [SqlPanelId, (typeof SQL_PANELS)[SqlPanelId]][]) {
    const area = AREA_LABEL[id.split('.')[0] ?? ''] ?? id.split('.')[0] ?? ''
    for (const c of p.concepts) {
      const rows = out[c.unit]
      let row = rows.find((r) => r.topic === c.topic)
      if (!row) {
        row = { topic: c.topic, features: [] }
        rows.push(row)
      }
      if (!row.features.some((f) => f.panelId === id)) row.features.push({ panelId: id, feature: p.title, area, topic: c.topic })
    }
  }
  return out
}

function UnitsMap() {
  const rows = unitRows()
  const units = Object.keys(UNIT_TITLES) as Unit[]
  return (
    <Tabs defaultValue="I" className="gap-3">
      <TabsList className="h-auto flex-wrap">
        {units.map((u) => (
          <TabsTrigger key={u} value={u} className="gap-2 px-3">
            <span>Unit <span className="font-mono font-semibold">{u}</span></span>
            <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular">{rows[u].length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {units.map((u) => {
        const highlights = UNITS.find((x) => x.unit === u)?.where ?? []
        return (
          <TabsContent key={u} value={u} className="space-y-3">
            <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-center gap-3 pb-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-soft font-mono text-sm font-semibold text-brand">
                  {u}
                </span>
                <span className="text-sm font-semibold">{UNIT_TITLES[u]}</span>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {highlights.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            {rows[u].length > 0 ? (
              <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-2/5 px-4 py-2 text-left font-medium">
                        Syllabus topic
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium">
                        Where it shows up (open its SQL)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows[u].map((r) => (
                      <tr key={r.topic} className="align-top">
                        <td className="px-4 py-2.5">{r.topic}</td>
                        <td className="px-4 py-2">
                          <ul className="flex flex-wrap gap-1.5">
                            {r.features.map((f) => (
                              <li
                                key={f.panelId}
                                className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 py-0.5 pr-0.5 pl-2.5 text-xs ring-1 ring-foreground/10"
                              >
                                <span className="font-medium">{f.feature}</span>
                                <span className="text-muted-foreground">· {f.area}</span>
                                <SqlButton panelId={f.panelId} />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                No data panel demonstrates this unit yet: it lives in MongoDB (notes, versions, portfolios) and the API.
              </p>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
