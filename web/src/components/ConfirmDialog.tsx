import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'destructive'
  /** May return a promise: the dialog stays open with a spinner until it settles, and
   *  closes only on success (errors are left to the caller, e.g. toastError). */
  onConfirm: () => unknown
  /** Uncontrolled usage: the element that opens the dialog. */
  trigger?: ReactNode
  /** Controlled usage. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Keep the confirm button disabled (e.g. until a confirmation phrase is typed). */
  confirmDisabled?: boolean
  children?: ReactNode
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  trigger,
  open,
  onOpenChange,
  confirmDisabled,
  children,
}: ConfirmDialogProps) {
  const [innerOpen, setInnerOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = (v: boolean) => {
    if (pending) return
    setInnerOpen(v)
    onOpenChange?.(v)
  }

  const run = async () => {
    setPending(true)
    try {
      await onConfirm()
      setPending(false)
      setInnerOpen(false)
      onOpenChange?.(false)
    } catch {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant={tone === 'destructive' ? 'destructive' : 'default'} onClick={run} disabled={pending || confirmDisabled}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
