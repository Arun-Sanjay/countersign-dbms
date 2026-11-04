import type { CSSProperties } from 'react'

/** Diagonal hatching for locked (final) components, as on a crossed-out paper column. */
export const LOCKED_HATCH: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklch, var(--foreground) 7%, transparent) 5px 6px)',
}
