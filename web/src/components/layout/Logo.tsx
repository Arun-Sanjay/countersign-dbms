import { cn } from '@/lib/utils'

/** The Countersign mark: a check signed over a signature line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-7', className)}>
      <rect width="24" height="24" rx="6.5" className="fill-brand" />
      <path
        d="M7 11.6l3 3 6.6-6.6"
        fill="none"
        className="stroke-brand-foreground"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 17.6h11" className="stroke-brand-foreground" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Countersign</div>
        {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  )
}
