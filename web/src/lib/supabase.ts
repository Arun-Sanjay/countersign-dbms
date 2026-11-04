import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/data/database.types'
import { env } from '@/lib/env'

/**
 * The one Supabase client. It only ever holds the publishable (anon) key: every query
 * runs as the signed-in user, so RLS policies and security_invoker views decide what
 * comes back. There is no service-role key anywhere in the web app.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'countersign.auth',
  },
})

export type Supabase = typeof supabase
