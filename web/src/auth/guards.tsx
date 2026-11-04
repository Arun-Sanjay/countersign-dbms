import { ShieldOff, UserX } from 'lucide-react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth, useProfile } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { AppShell } from '@/components/layout/AppShell'
import { PublicShell } from '@/components/layout/PublicShell'
import { FullPageLoader, PageSkeleton } from '@/components/Skeletons'
import { Button } from '@/components/ui/button'
import { useNavProjects } from '@/data/hub'
import type { AppRole } from '@/data/types'

/** Signed in AND linked to an app_user row, or redirect to /login?next=… */
export function RequireAuth() {
  const { status, profileStatus, profileError, signOut, signedOutByUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (status === 'loading') return <FullPageLoader />
  if (status === 'signedOut') {
    const next = location.pathname + location.search
    const keepNext = !signedOutByUser && next && next !== '/'
    return <Navigate to={keepNext ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />
  }
  if (profileStatus === 'loading' || profileStatus === 'idle') return <FullPageLoader label="Loading your profile" />
  if (profileStatus === 'error') {
    return (
      <div className="mx-auto flex min-h-svh max-w-lg items-center px-6">
        <ErrorState error={profileError} onRetry={() => window.location.reload()} className="w-full" />
      </div>
    )
  }
  if (profileStatus === 'missing') {
    return (
      <div className="mx-auto flex min-h-svh max-w-md items-center px-6">
        <EmptyState
          icon={UserX}
          title="This login is not linked to a profile"
          description="Row-level security shows nothing to an account without an app_user row. Ask an admin to link it to a student or faculty record."
          action={
            <Button
              variant="outline"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            >
              Sign out
            </Button>
          }
          className="w-full"
        />
      </div>
    )
  }
  return <Outlet />
}

/** Only these roles may see the nested routes; others get an explanation, not a blank page. */
export function RequireRole({ roles }: { roles: AppRole[] }) {
  const profile = useProfile()
  if (!roles.includes(profile.role)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title={`This page is for ${roles.join(' / ')} accounts`}
        description={roleGuardCopy(profile.role, roles)}
        action={
          <Button asChild variant="outline">
            <Link to="/">Go to my home</Link>
          </Button>
        }
      />
    )
  }
  return <Outlet />
}

/** Why this role cannot use the page, stated the way RLS actually behaves (no overclaiming). */
function roleGuardCopy(role: AppRole, allowed: AppRole[]): string {
  if (allowed.includes('faculty') && role === 'student') {
    return 'This screen is for faculty. Through row-level security you could only read your own team’s rows here; your own marks and claims are on your project page.'
  }
  if (allowed.includes('student')) {
    return `You are signed in as ${role}. This screen is built from the signed-in student’s own team and claims, and a staff login has none.`
  }
  return `You are signed in as ${role}. The directory is for admin accounts.`
}

/** /login while already signed in -> home (or ?next=). */
export function RedirectIfSignedIn() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageLoader />
  if (status === 'signedIn') {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={next?.startsWith('/') ? next : '/'} replace />
  }
  return <Outlet />
}

/** "/" -> the role's landing page. */
export function HomeRedirect() {
  const profile = useProfile()
  const projects = useNavProjects()
  if (profile.role === 'student') return <Navigate to="/hub" replace />
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  if (profile.role === 'faculty') return <Navigate to="/teaching" replace />
  if (projects.isPending) return <PageSkeleton />
  const first = projects.data?.[0]
  return <Navigate to={first ? `/sheet/${first.projectId}` : '/contested'} replace />
}

/** /sheet or /marks without a project id -> the first project this user oversees. */
export function FirstProjectRedirect({ base }: { base: '/sheet' | '/marks' | '/projects' }) {
  const projects = useNavProjects()
  if (projects.isPending) return <PageSkeleton />
  const first = projects.data?.[0]
  if (!first) {
    return (
      <EmptyState
        title="No projects yet"
        description="There is no project linked to your account for this term."
      />
    )
  }
  return <Navigate to={`${base}/${first.projectId}`} replace />
}

/** Public pages (/about) use the app chrome when signed in, a minimal frame otherwise. */
export function MaybeShell() {
  const { status, profileStatus } = useAuth()
  if (status === 'loading') return <FullPageLoader />
  return status === 'signedIn' && profileStatus === 'ready' ? <AppShell /> : <PublicShell />
}
