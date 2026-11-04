import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import type { FieldError } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FormFieldProps {
  label: ReactNode
  /** react-hook-form error (client zod or server, via applyServerError) or a plain string. */
  error?: FieldError | string
  hint?: ReactNode
  required?: boolean
  /** Right-aligned extra in the label row, e.g. a character counter. */
  aside?: ReactNode
  className?: string
  /** One control (Input, Textarea, SelectTrigger ...). It receives id + aria attributes. */
  children: ReactNode
}

/**
 * Label + control + hint/error, wired for accessibility: the control gets an id, and
 * aria-invalid / aria-describedby point at the message.
 */
export function FormField({ label, error, hint, required, aside, className, children }: FormFieldProps) {
  const id = useId()
  const message = typeof error === 'string' ? error : error?.message
  const describedBy = message ? `${id}-error` : hint ? `${id}-hint` : undefined

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        'aria-invalid': message ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={(isValidElement(children) && (children.props as { id?: string }).id) || id}>
          {label}
          {required ? <span className="text-muted-foreground">*</span> : null}
        </Label>
        {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {control}
      {message ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
