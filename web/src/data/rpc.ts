import { supabase } from '@/lib/supabase'
import { throwIfError } from '@/lib/errors'
import type { RpcArgs, RpcName } from '@/data/types'

/**
 * Call a Postgres function through PostgREST (/rest/v1/rpc/<name>) as the signed-in user.
 * Errors are thrown already mapped (AppErrorException: friendly title/message, field,
 * SQLSTATE and DETAIL rule key), so `useMutation({ onError: toastError })` just works.
 *
 *   const hub = await rpc<SemesterHub>('semester_hub')
 *   await rpc<JoinTeamResult>('join_team', { p_team_id: 'T06' })
 */
export async function rpc<T, F extends RpcName = RpcName>(fn: F, args?: RpcArgs<F>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as never)
  throwIfError(error)
  return data as T
}
