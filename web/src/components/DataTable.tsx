import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface Column<T> {
  /** Stable id; also the default accessor when `cell` / `sortValue` are omitted. */
  key: string
  header: ReactNode
  cell?: (row: T) => ReactNode
  /** Value used for sorting; enables the sort toggle on this column. */
  sortValue?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  className?: string
  headerClassName?: string
  /** Fixed width, e.g. "6rem". */
  width?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T, index: number) => string
  loading?: boolean
  /** Shown when rows is empty (defaults to a generic EmptyState). */
  empty?: ReactNode
  onRowClick?: (row: T) => void
  /** Highlight a row (e.g. the selected one). */
  isRowActive?: (row: T) => boolean
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  dense?: boolean
  skeletonRows?: number
  className?: string
}

function defaultValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

/**
 * Lightweight table: typed columns, optional client-side sort, skeleton rows while
 * loading, an empty state, and clickable rows. No pagination (our sets are small).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  isRowActive,
  initialSort,
  dense,
  skeletonRows = 4,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort)

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const out = [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true })
    })
    return sort.dir === 'desc' ? out.reverse() : out
  }, [rows, sort, columns])

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : undefined))

  const alignClass = (a?: Column<T>['align']) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : '')

  if (!loading && sorted && sorted.length === 0) {
    return <>{empty ?? <EmptyState compact title="Nothing here yet" />}</>
  }

  return (
    <div className={cn('overflow-hidden rounded-lg ring-1 ring-foreground/10', className)}>
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const active = sort?.key === c.key
              return (
                <TableHead
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn('h-9 text-xs font-medium text-muted-foreground', alignClass(c.align), c.headerClassName)}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded hover:text-foreground',
                        c.align === 'right' && 'flex-row-reverse',
                        active && 'text-foreground',
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading || !sorted
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                  {columns.map((c) => (
                    <TableCell key={c.key} className={dense ? 'py-1.5' : 'py-2.5'}>
                      <Skeleton className={cn('h-4', c.align === 'right' ? 'ml-auto w-10' : 'w-3/4')} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : sorted.map((row, i) => (
                <TableRow
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  data-state={isRowActive?.(row) ? 'selected' : undefined}
                  className={cn(onRowClick && 'cursor-pointer', 'data-[state=selected]:bg-brand-soft/60')}
                >
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(dense ? 'py-1.5' : 'py-2.5', alignClass(c.align), c.className)}
                    >
                      {c.cell ? c.cell(row) : String(defaultValue(row, c.key) ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}
