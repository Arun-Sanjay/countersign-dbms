import {
  BookOpenText,
  ChevronsUpDown,
  ClipboardList,
  Eye,
  FolderKanban,
  Gauge,
  GraduationCap,
  Info,
  LayoutGrid,
  LogOut,
  NotebookPen,
  ScrollText,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useAuth, useProfile } from '@/auth/AuthProvider'
import { LogoMark } from '@/components/layout/Logo'
import { RoleChip } from '@/components/layout/RoleChip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useNavProjects, type NavProject } from '@/data/hub'
import { backendKind } from '@/lib/env'
import { initials } from '@/lib/format'
import { toastError } from '@/lib/notify'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** match nested paths too (default: exact) */
  prefix?: boolean
}

function NavItems({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.prefix ? pathname.startsWith(item.to) : pathname === item.to
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
              <NavLink to={item.to}>
                <item.icon />
                <span>{item.label}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function ProjectGroup({
  label,
  projects,
  loading,
  build,
}: {
  label: string
  projects: NavProject[] | undefined
  loading: boolean
  build: (p: NavProject) => NavItem[]
}) {
  if (loading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    )
  }
  if (!projects?.length) return null
  return (
    <>
      {projects.map((p) => (
        <SidebarGroup key={p.projectId}>
          <SidebarGroupLabel title={p.title}>
            <span className="truncate">
              {p.projectId} · {p.title}
            </span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={build(p)} />
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

/** "Team Countersign (T00)": the team, never just a bare name that reads like the product. */
function teamLabel(p: NavProject): string {
  if (!p.teamName) return 'Project'
  const name = /^team\b/i.test(p.teamName) ? p.teamName : `Team ${p.teamName}`
  return p.teamId ? `${name} (${p.teamId})` : name
}

export function AppSidebar() {
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const projects = useNavProjects()

  const onSignOut = async () => {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent">
              <NavLink to="/">
                <LogoMark className="size-8" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-[15px] font-semibold tracking-tight">Countersign</span>
                  <span className="truncate text-[11px] text-muted-foreground">Every mark has a receipt</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {profile.role === 'student' ? (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Semester</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavItems
                  items={[
                    { to: '/hub', label: 'Semester hub', icon: LayoutGrid },
                    { to: '/team', label: 'Team & skills', icon: Users },
                  ]}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            <ProjectGroup
              label="Projects"
              projects={projects.data}
              loading={projects.isPending}
              build={(p) => [{ to: `/projects/${p.projectId}`, label: teamLabel(p), icon: FolderKanban }]}
            />
            <SidebarGroup>
              <SidebarGroupLabel>Privacy</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavItems
                  items={[
                    { to: '/notes', label: 'Private notes', icon: NotebookPen },
                    { to: '/faculty-view', label: 'What my faculty sees', icon: Eye },
                  ]}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}

        {profile.role === 'faculty' || profile.role === 'admin' ? (
          <>
            {profile.role === 'admin' ? (
              <SidebarGroup>
                <SidebarGroupLabel>Admin</SidebarGroupLabel>
                <SidebarGroupContent>
                  <NavItems items={[{ to: '/admin', label: 'Directory', icon: Gauge }]} />
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
            <SidebarGroup>
              <SidebarGroupLabel>Review</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavItems
                  items={[
                    ...(profile.role === 'faculty' ? [{ to: '/teaching', label: 'My projects', icon: LayoutGrid }] : []),
                    { to: '/contested', label: 'Contested claims', icon: TriangleAlert },
                  ]}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            <ProjectGroup
              label="Projects"
              projects={projects.data}
              loading={projects.isPending}
              build={(p) => [
                { to: `/sheet/${p.projectId}`, label: p.isLab ? 'Rubric sheet' : 'Marks sheet', icon: ClipboardList },
                // only lab-structured projects are on the lab CIE (/50); elsewhere it is a dead end
                ...(p.isLab ? [{ to: `/marks/${p.projectId}`, label: 'Lab CIE marks', icon: GraduationCap }] : []),
              ]}
            />
          </>
        ) : null}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <NavItems items={[{ to: '/about', label: 'How it works', icon: Info }]} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" data-testid="user-menu">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-brand-soft text-xs font-semibold text-brand">
                      {initials(profile.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium" data-testid="current-user-name">
                      {profile.displayName}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground" title={profile.subtitle}>{profile.subtitle}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {profile.displayName} <RoleChip role={profile.role} />
                  </span>
                  <span className="text-xs text-muted-foreground">{profile.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/about')}>
                  <BookOpenText /> How Countersign works
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <ScrollText /> Backend: {backendKind === 'local' ? 'local Supabase' : 'Supabase cloud'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSignOut} data-testid="sign-out">
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
