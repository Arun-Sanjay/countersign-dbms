import { QueryClient } from '@tanstack/react-query'
import { toAppError } from '@/lib/errors'

/** Errors that will not get better by retrying (permissions, validation, rules). */
function isPermanent(error: unknown): boolean {
  const e = toAppError(error)
  return e.kind !== 'network' && e.kind !== 'serialization'
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !isPermanent(error) && count < 2,
    },
    mutations: {
      retry: (count, error) => toAppError(error).kind === 'serialization' && count < 2,
    },
  },
})
