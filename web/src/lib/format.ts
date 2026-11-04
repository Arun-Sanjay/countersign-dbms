const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const relFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// A Postgres DATE ("2026-11-02"), or a DATE cast to timestamptz by a view
// ("2026-11-02T00:00:00+00:00", e.g. artifact.created_at::timestamptz): a calendar day.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00:00(?:\.0+)?(?:Z|\+00(?::?00)?))?$/

/** True for DATE values (no time of day was recorded). */
export function isDateOnly(value: string | Date | null | undefined): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value)
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  // A DATE column is a calendar day, not an instant: build it in local time, or
  // new Date('2026-11-02') means UTC midnight and shows up as "5:30 am" in IST.
  const m = typeof value === 'string' ? DATE_ONLY.exec(value) : null
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 12 Sept 2026 */
export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? dateFmt.format(d) : fallback
}

/** 12 Sept 2026, 6:10 pm. A DATE value (no time part) is shown as a date only. */
export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  if (isDateOnly(value)) return formatDate(value, fallback)
  const d = toDate(value)
  return d ? dateTimeFmt.format(d) : fallback
}

/** "3 days ago", "in 2 weeks" */
export function formatRelative(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  const seconds = (d.getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relFmt.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** 4.5 -> "4.5", 5 -> "5", null -> "—" */
export function formatMarks(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined) return fallback
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** "S Arun Sanjay" -> "SA" */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const all = name.replace(/^(Dr|Prof)\.?\s+/i, '').split(/\s+/).filter(Boolean)
  // "S Arun Sanjay" -> AS: skip single-letter initials when there are enough full names
  const full = all.filter((p) => p.length > 1)
  const parts = full.length >= 2 ? full : all
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Milestone number -> lab component label: 4 -> "C4" */
export function componentLabel(milestoneNo: number): string {
  return `C${milestoneNo}`
}

/** "S Arun Sanjay" -> "Arun", "Dr. Ramesh Babu" -> "Ramesh" */
export function firstName(name: string | null | undefined): string {
  if (!name) return ''
  const parts = name.replace(/^(Dr|Prof)\.?\s+/i, '').split(/\s+/).filter(Boolean)
  return parts.find((p) => p.length > 1) ?? parts[0] ?? ''
}

/** Today as a DATE string in local time ("2026-11-04"), to compare with DATE columns. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
