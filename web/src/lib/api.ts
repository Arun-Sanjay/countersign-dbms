/**
 * The Countersign FastAPI service (api/): Mongo notes, the ingestion worker, /ask and the
 * cross-database consistency check. Every call carries the caller's own Supabase access
 * token; the API asks Postgres as that user, so RLS still decides what comes back.
 */
import { supabase } from '@/lib/supabase'

/** Base URL of the API. Override with VITE_API_URL; defaults to the local dev server. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

/** How to start it locally (shown in offline states). */
export const API_START_HINT = 'cd api && uv run uvicorn app.main:app --port 8000'

/** An API failure: `offline` when the service did not answer at all. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly offline: boolean
  constructor(status: number, code: string, message: string, offline = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.offline = offline
  }
}

export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.offline
}

/** The endpoint exists in this build of the API? (404/405 = an older API without it). */
export function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405) && error.code.startsWith('http_')
}

async function apiFetch<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 6000),
    })
  } catch {
    throw new ApiError(0, 'api_offline', `The Countersign API at ${API_URL} did not answer.`, true)
  }
  if (!res.ok) {
    let code = `http_${res.status}`
    let message = res.statusText || 'Request failed'
    try {
      const body = (await res.json()) as { detail?: { code?: string; message?: string } | string | unknown[] }
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = 'The API rejected the request (validation error).'
      else if (body.detail) {
        code = body.detail.code ?? code
        message = body.detail.message ?? message
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message)
  }
  return (await res.json()) as T
}

export function apiGet<T>(path: string, timeoutMs?: number): Promise<T> {
  return apiFetch<T>(path, { method: 'GET', timeoutMs })
}

export function apiPost<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body, timeoutMs })
}
