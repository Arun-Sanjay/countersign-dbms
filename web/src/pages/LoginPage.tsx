import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, CheckCircle2, FileCode2, GitCommitHorizontal, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { DEMO_PASSWORD, PERSONAS, type Persona } from '@/auth/personas'
import { FormField } from '@/components/FormField'
import { Logo } from '@/components/layout/Logo'
import { RoleChip } from '@/components/layout/RoleChip'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { backendKind, env, envError } from '@/lib/env'
import { initials } from '@/lib/format'
import { applyServerError, toastError } from '@/lib/notify'
import { cn } from '@/lib/utils'

const signInSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
type SignInValues = z.infer<typeof signInSchema>

/** The thesis, drawn: a rubric cell with its claim, evidence and countersign. */
function ReceiptIllustration() {
  return (
    <div className="relative w-full max-w-sm rounded-2xl bg-card p-5 shadow-[0_1px_0_0_var(--border),0_24px_48px_-24px_color-mix(in_oklch,var(--foreground)_25%,transparent)] ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">P06 · Component C4</div>
          <div className="text-sm font-semibold">Test</div>
        </div>
        <div className="tabular text-right">
          <span className="text-2xl font-semibold tracking-tight">19</span>
          <span className="text-sm text-muted-foreground"> / 20</span>
        </div>
      </div>
      <div className="perforation my-4 h-0.5" />
      <div className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <p className="text-pretty text-muted-foreground">
            <span className="font-medium text-foreground">Claim · </span>
            Wrote and executed the SQL Test queries on our own schema in Supabase.
          </p>
          <StatusBadge status="confirmed" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            <GitCommitHorizontal className="size-3" /> 3f9c2ab
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            <FileCode2 className="size-3" /> 03_queries.sql
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            AI declared: assisted
          </span>
        </div>
      </div>
      <div className="perforation my-4 h-0.5" />
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-confirmed" />
        <span>
          Countersigned by <span className="font-medium">Sanvid Razdan</span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">rev 3</span>
      </div>
    </div>
  )
}

function PersonaButton({ persona, busy, disabled, onClick }: { persona: Persona; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={`persona-${persona.key}`}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 ring-foreground/10 transition-colors',
        'hover:bg-muted/60 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        busy && 'bg-brand-soft/60 ring-brand/30',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
          persona.role === 'student' ? 'bg-brand-soft text-brand' : persona.role === 'faculty' ? 'bg-info-soft text-info' : 'bg-secondary text-secondary-foreground',
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : initials(persona.name)}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{persona.name}</span>
          <RoleChip role={persona.role} />
          {persona.tags.map((t) => (
            <span key={t} className="rounded-full bg-muted px-1.5 text-[10.5px] leading-[18px] text-muted-foreground">
              {t}
            </span>
          ))}
        </span>
        <span className="line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{persona.blurb}</span>
      </span>
      <ArrowRight className="mt-2.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const [personaBusy, setPersonaBusy] = useState<string | null>(null)

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signIn(values.email.trim(), values.password)
      // RedirectIfSignedIn takes it from here (to ?next= or the role's home).
    } catch (e) {
      applyServerError(e, form.setError, ['email', 'password'])
    }
  })

  const loginAs = async (p: Persona) => {
    setPersonaBusy(p.key)
    try {
      await signIn(p.email, DEMO_PASSWORD)
    } catch (e) {
      toastError(e)
      setPersonaBusy(null)
    }
  }

  const busy = form.formState.isSubmitting || personaBusy !== null

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      {/* brand side */}
      <aside className="relative hidden overflow-hidden border-r bg-sidebar lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        />
        <div className="relative flex flex-1 flex-col justify-between p-10">
          <Logo subtitle="CD252IA · RVCE" />
          <div className="space-y-10">
            <div className="max-w-md space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-balance">Every mark has a receipt.</h1>
              <p className="text-base leading-relaxed text-pretty text-muted-foreground">
                Each cell of the lab marks sheet links to the claims behind it, each claim to its evidence, and each piece of
                evidence to a teammate&apos;s countersign. Not AI detection: traceable, defensible work.
              </p>
            </div>
            <ReceiptIllustration />
          </div>
          <p className="text-xs text-muted-foreground">
            PostgreSQL row-level security decides what every query returns. Open any panel&apos;s{' '}
            <span className="font-mono">&lt;/&gt; SQL</span> to see exactly how.
          </p>
        </div>
      </aside>

      {/* form side */}
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-8">
          <div className="w-full max-w-xl space-y-8">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-semibold tracking-tight">Sign in to Countersign</h2>
              <p className="text-sm text-muted-foreground">Unified Experiential Learning Platform — RVCE CD252IA</p>
            </div>

            {envError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Configuration problem: {envError}. See web/README.md.
              </p>
            ) : null}

            <form onSubmit={onSubmit} className="max-w-md space-y-4" noValidate>
              <FormField label="Email" error={form.formState.errors.email}>
                <Input type="email" autoComplete="email" placeholder="you@example.edu" {...form.register('email')} />
              </FormField>
              <FormField label="Password" error={form.formState.errors.password}>
                <Input type="password" autoComplete="current-password" {...form.register('password')} />
              </FormField>
              <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="sign-in">
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Sign in
              </Button>
            </form>

            {env.showPersonas ? (
              <section className="space-y-3" aria-labelledby="personas-heading">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <h3 id="personas-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Demo personas
                  </h3>
                  <div className="h-px flex-1 bg-border" />
                </div>
                {(
                  [
                    ['student', 'Students'],
                    ['faculty', 'Faculty'],
                    ['admin', 'Admin'],
                  ] as const
                ).map(([role, heading]) => (
                  <div key={role} className="space-y-1.5">
                    <h4 className="text-[11px] font-medium text-muted-foreground">{heading}</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {PERSONAS.filter((p) => p.role === role).map((p) => (
                        <PersonaButton
                          key={p.key}
                          persona={p}
                          busy={personaBusy === p.key}
                          disabled={busy}
                          onClick={() => loginAs(p)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-center text-xs text-muted-foreground">
                  Synthetic @example.edu accounts · connected to{' '}
                  <span className="font-medium">{backendKind === 'local' ? 'the local Supabase stack' : 'Supabase cloud'}</span>
                </p>
              </section>
            ) : null}

            <p className="text-center text-sm text-muted-foreground">
              New here?{' '}
              <Link to="/about" className="font-medium text-foreground underline-offset-4 hover:underline">
                How Countersign works
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
