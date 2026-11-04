import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import {
  FirstProjectRedirect,
  HomeRedirect,
  MaybeShell,
  RedirectIfSignedIn,
  RequireAuth,
  RequireRole,
} from '@/auth/guards'
import { AppShell } from '@/components/layout/AppShell'
import { FullPageLoader } from '@/components/Skeletons'

/** Route-level code splitting: each page is its own chunk. */
function page(load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: (await load()).default }) }
}

/**
 * Route map. Page files (owned by page agents):
 *   student  /hub  /team  /projects/:projectId  /notes  /faculty-view
 *   faculty  /teaching  /sheet/:projectId  /contested  /marks/:projectId     (admins may open these too)
 *   admin    /admin
 *   shared   /login  /about
 */
export const routes: RouteObject[] = [
  {
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      {
        element: <RedirectIfSignedIn />,
        children: [{ path: '/login', ...page(() => import('@/pages/LoginPage')) }],
      },
      {
        element: <MaybeShell />,
        children: [{ path: '/about', ...page(() => import('@/pages/AboutPage')) }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomeRedirect /> },
              {
                element: <RequireRole roles={['student']} />,
                children: [
                  { path: '/hub', ...page(() => import('@/pages/student/HubPage')) },
                  { path: '/team', ...page(() => import('@/pages/student/TeamPage')) },
                  { path: '/projects', element: <FirstProjectRedirect base="/projects" /> },
                  { path: '/projects/:projectId', ...page(() => import('@/pages/student/ProjectPage')) },
                  { path: '/notes', ...page(() => import('@/pages/student/NotesPage')) },
                  { path: '/faculty-view', ...page(() => import('@/pages/student/FacultyViewPage')) },
                ],
              },
              {
                element: <RequireRole roles={['faculty', 'admin']} />,
                children: [
                  { path: '/teaching', ...page(() => import('@/pages/faculty/FacultyHomePage')) },
                  { path: '/sheet', element: <FirstProjectRedirect base="/sheet" /> },
                  { path: '/sheet/:projectId', ...page(() => import('@/pages/faculty/RubricSheetPage')) },
                  { path: '/contested', ...page(() => import('@/pages/faculty/ContestedPage')) },
                  { path: '/marks', element: <FirstProjectRedirect base="/marks" /> },
                  { path: '/marks/:projectId', ...page(() => import('@/pages/faculty/MarksPage')) },
                ],
              },
              {
                element: <RequireRole roles={['admin']} />,
                children: [{ path: '/admin', ...page(() => import('@/pages/admin/AdminPage')) }],
              },
              { path: '/home', element: <Navigate to="/" replace /> },
              { path: '*', ...page(() => import('@/pages/NotFoundPage')) },
            ],
          },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
