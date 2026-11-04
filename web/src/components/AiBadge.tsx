import { Bot, Sparkles } from 'lucide-react'
import { aiDeclaredLabel } from '@/lib/ai'
import type { AiAssistance } from '@/lib/rules'
import { cn } from '@/lib/utils'

/** The declared AI assistance of a claim, version or note. Declared by the student, never detected. */
export function AiBadge({ value, className }: { value: AiAssistance | string | null | undefined; className?: string }) {
  if (!value) return null
  const Icon = value === 'none' ? Bot : Sparkles
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs whitespace-nowrap ring-1 ring-inset',
        value === 'none' ? 'text-muted-foreground ring-border' : 'bg-info-soft text-info ring-info/25',
        className,
      )}
      title="Declared by the student. Countersign never tries to detect AI."
    >
      <Icon className="size-3" aria-hidden />
      {aiDeclaredLabel(value)}
    </span>
  )
}
