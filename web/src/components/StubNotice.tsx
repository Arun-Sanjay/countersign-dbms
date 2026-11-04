import { Hammer } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { getSqlPanel, type SqlPanelId } from '@/sql/registry'

/**
 * Placeholder used by not-yet-built pages: one Panel per registry entry the page will
 * show, so the Show-the-SQL drawer already works. Page owners replace this.
 */
export function StubNotice({ panels }: { panels: SqlPanelId[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {panels.map((id) => {
        const p = getSqlPanel(id)
        return (
          <Panel key={id} title={p.title} description={p.summary} sqlId={id}>
            <EmptyState compact icon={Hammer} title="Being built" description="The data behind this panel is ready; its view is next." />
          </Panel>
        )
      })}
    </div>
  )
}
