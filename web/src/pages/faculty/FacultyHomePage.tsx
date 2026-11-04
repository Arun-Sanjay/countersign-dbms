import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useProfile } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { useTaughtProjects } from '@/data/faculty'
import { ProjectCards } from './components/ProjectCards'

/** /teaching — faculty landing: the projects you teach, each linking to its sheet and marks (an admin sees every project). */
export default function FacultyHomePage() {
  const profile = useProfile()
  const isAdmin = profile.role === 'admin'
  const q = useTaughtProjects()
  const contested = (q.data ?? []).reduce((n, p) => n + p.claimsContested, 0)
  const pending = (q.data ?? []).reduce((n, p) => n + p.claimsPending, 0)

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? 'Admin oversight' : profile.subtitle}
        title={`Welcome, ${profile.displayName}`}
        description={
          isAdmin
            ? 'Every project on the platform, for oversight. Each one opens as a live marks sheet: every cell leads to the claims, evidence and countersigns behind it.'
            : 'The projects you teach. Each one opens as a live marks sheet: every cell leads to the claims, evidence and countersigns behind it.'
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/contested">
              <TriangleAlert /> Contested claims
            </Link>
          </Button>
        }
        meta={
          q.data ? (
            <>
              <StatusBadge status="team" label={`${q.data.length} project${q.data.length === 1 ? '' : 's'}`} />
              {contested > 0 ? <StatusBadge status="contested" label={`${contested} contested`} /> : null}
              {pending > 0 ? <StatusBadge status="pending" label={`${pending} awaiting countersign`} /> : null}
            </>
          ) : null
        }
      />
      <Panel
        title={isAdmin ? 'All projects (admin oversight)' : 'Projects you teach'}
        description={
          isAdmin
            ? 'Every project in every course and term. The teaching faculty record marks; an admin can view each sheet and lock components.'
            : 'A project is yours if you teach its course offering, or, for practice projects without an offering, the course itself.'
        }
        sqlId="faculty.projects"
      >
        <ProjectCards />
      </Panel>
    </>
  )
}
