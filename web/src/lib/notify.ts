import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { errorTag, toAppError, type AppError } from '@/lib/errors'

/** Show any error as a toast: friendly title + message, with the SQLSTATE/rule tag below. */
export function toastError(error: unknown, fallbackTitle?: string): AppError {
  const e = toAppError(error)
  const tag = errorTag(e)
  toast.error(e.title || fallbackTitle || 'Something went wrong', {
    description: tag ? `${e.message}  (${tag})` : e.message,
  })
  return e
}

export function toastSuccess(title: string, description?: string): void {
  toast.success(title, { description })
}

/**
 * Attach a server error to the matching react-hook-form field when the DB named one
 * (e.g. DETAIL 'statement' -> field "statement"); otherwise fall back to a toast.
 * `fields` lists the field names this form actually has.
 *
 *   onError: (err) => applyServerError(err, form.setError, ['statement', 'contribution_type'])
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): AppError {
  const e = toAppError(error)
  const field = e.field as Path<T> | undefined
  if (field && fields.includes(field)) {
    setError(field, { type: 'server', message: e.message }, { shouldFocus: true })
  } else {
    toastError(e)
  }
  return e
}
