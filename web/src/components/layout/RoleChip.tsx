import type { AppRole } from '@/data/types'
import { cn } from '@/lib/utils'

const ROLE_STYLE: Record<AppRole, string> = {
  student: 'bg-brand-soft text-brand',
  faculty: 'bg-info-soft text-info',
  admin: 'bg-secondary text-secondary-foreground',
}

export function RoleChip({ role, className }: { role: AppRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium tracking-wide capitalize',
        ROLE_STYLE[role],
        className,
      )}
    >
      {role}
    </span>
  )
}
