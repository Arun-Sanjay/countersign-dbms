import { focusManager, QueryClient } from '@tanstack/react-query'
import { toAppError } from '@/lib/errors'

/** Errors that will not get better by retrying (permissions, validation, rules). */
function isPermanent(error: unknown): boolean {
  const e = toAppError(error)
  return e.kind !== 'network' && e.kind !== 'serialization'
}

/**
 * "The window came back": TanStack Query listens to visibilitychange only, which does not fire
 * when the user switches between two visible browser windows (the demo's faculty and student
 * profiles side by side). Also listen to the window's own focus event. Only queries that opt in
 * with refetchOnWindowFocus react (the default below stays false, so forms keep their state).
 */
focusManager.setEventListener((handleFocus) => {
  if (typeof window === 'undefined' || !window.addEventListener) return undefined
  const listener = () => handleFocus()
  window.addEventListener('visibilitychange', listener, false)
  window.addEventListener('focus', listener, false)
  return () => {
    window.removeEventListener('visibilitychange', listener)
    window.removeEventListener('focus', listener)
  }
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // opt in per query (the rubric sheet and its drawer: KNOWN_ISSUES #5), not globally
      refetchOnWindowFocus: false,
      retry: (count, error) => !isPermanent(error) && count < 2,
    },
    mutations: {
      retry: (count, error) => toAppError(error).kind === 'serialization' && count < 2,
    },
  },
})
