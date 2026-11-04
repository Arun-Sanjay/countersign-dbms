/** Date-only helpers for deadlines (milestone.deadline is a DATE: compare calendar days). */

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole calendar days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.round((startOfDay(new Date(y, m - 1, d)) - startOfDay(new Date())) / 86_400_000)
}

/** "Due today", "Tomorrow", "in 6 days", "3 days ago" */
export function countdownLabel(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** Tone of a countdown: soon (≤ 3 days) is amber, past is muted. */
export function countdownTone(days: number | null): 'soon' | 'later' | 'past' | 'none' {
  if (days === null) return 'none'
  if (days < 0) return 'past'
  return days <= 3 ? 'soon' : 'later'
}
