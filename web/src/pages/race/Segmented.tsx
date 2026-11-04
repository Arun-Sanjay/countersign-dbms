import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: ReactNode; title?: string }[]
  label: string
  className?: string
}

/** A segmented control (the design system's Tabs list, without panels). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <TabsList aria-label={label}>
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} title={o.title} className="px-2.5">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
