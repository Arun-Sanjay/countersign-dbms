import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { keys } from '@/data/keys'
import type { AppRole } from '@/data/types'
import { throwIfError, toAppError, type AppError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** The signed-in user's app identity: auth.users -> app_user -> student | faculty. */
export interface Profile {
  userId: string
  email: string
  role: AppRole
  usn: string | null
  facultyId: string | null
  displayName: string
  /** USN, "F01 · Professor", or "Administrator" */
  subtitle: string
  section?: string | null
}

type SessionStatus = 'loading' | 'signedOut' | 'signedIn'

interface AuthContextValue {
  status: SessionStatus
  session: Session | null
  profile: Profile | null
  /** 'missing' = signed in but no app_user row (RLS shows nothing to such a login). */
  profileStatus: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  profileError: AppError | null
  /** True after the user clicked "Sign out" (so /login is shown without a ?next=). */
  signedOutByUser: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(userId: string, email: string): Promise<Profile | null> {
  // RLS (app_user_select): a user reads only their own row.
  const { data: au, error } = await supabase
    .from('app_user')
    .select('user_id, role, usn, faculty_id')
    .eq('user_id', userId)
    .maybeSingle()
  throwIfError(error)
  if (!au) return null
  const role = au.role as AppRole

  if (role === 'student' && au.usn) {
    const { data: s, error: e } = await supabase
      .from('student')
      .select('name, section')
      .eq('usn', au.usn)
      .maybeSingle()
    throwIfError(e)
    return {
      userId,
      email,
      role,
      usn: au.usn,
      facultyId: null,
      displayName: s?.name ?? au.usn,
      subtitle: au.usn,
      section: s?.section ?? null,
    }
  }
  if (role === 'faculty' && au.faculty_id) {
    const { data: f, error: e } = await supabase
      .from('faculty')
      .select('name, designation')
      .eq('faculty_id', au.faculty_id)
      .maybeSingle()
    throwIfError(e)
    return {
      userId,
      email,
      role,
      usn: null,
      facultyId: au.faculty_id,
      displayName: f?.name ?? au.faculty_id,
      subtitle: f ? `${au.faculty_id} · ${f.designation}` : au.faculty_id,
    }
  }
  return { userId, email, role, usn: null, facultyId: null, displayName: 'Administrator', subtitle: email }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [signedOutByUser, setSignedOutByUser] = useState(false)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setStatus(data.session ? 'signedIn' : 'signedOut')
    })
    // Keep this callback synchronous: calling other supabase methods inside it can deadlock.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setStatus(next ? 'signedIn' : 'signedOut')
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: keys.profile(userId),
    queryFn: () => fetchProfile(userId!, session?.user.email ?? ''),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  })

  const signIn = useCallback(
    async (email: string, password: string) => {
      queryClient.clear() // nothing cached for the previous user may leak into the next
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      setSignedOutByUser(false)
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    setSignedOutByUser(true)
    const { error } = await supabase.auth.signOut()
    queryClient.clear()
    if (error) throw error
  }, [queryClient])

  const value = useMemo<AuthContextValue>(() => {
    let profileStatus: AuthContextValue['profileStatus'] = 'idle'
    if (userId) {
      if (profileQuery.isPending) profileStatus = 'loading'
      else if (profileQuery.isError) profileStatus = 'error'
      else profileStatus = profileQuery.data ? 'ready' : 'missing'
    }
    return {
      status,
      session,
      profile: profileQuery.data ?? null,
      profileStatus,
      profileError: profileQuery.error ? toAppError(profileQuery.error) : null,
      signedOutByUser,
      signIn,
      signOut,
    }
  }, [
    status,
    session,
    userId,
    profileQuery.isPending,
    profileQuery.isError,
    profileQuery.data,
    profileQuery.error,
    signedOutByUser,
    signIn,
    signOut,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** The profile, for components rendered behind <RequireAuth> (never null there). */
// eslint-disable-next-line react-refresh/only-export-components
export function useProfile(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('useProfile used outside a signed-in route')
  return profile
}
