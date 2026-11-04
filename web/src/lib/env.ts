import { z } from 'zod'

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url({ message: 'VITE_SUPABASE_URL must be a URL' }),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY is missing'),
  VITE_SHOW_PERSONAS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
})

const parsed = EnvSchema.safeParse(import.meta.env)

/** Problems with the Vite env, shown on screen instead of a blank page. */
export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => i.message).join('; ')

export const env = {
  supabaseUrl: parsed.success ? parsed.data.VITE_SUPABASE_URL : 'http://127.0.0.1:54321',
  supabaseAnonKey: parsed.success ? parsed.data.VITE_SUPABASE_ANON_KEY : 'missing-anon-key',
  showPersonas: parsed.success ? parsed.data.VITE_SHOW_PERSONAS : true,
  mode: import.meta.env.MODE,
}

/** "local" when pointed at the Supabase CLI stack, else "cloud". */
export const backendKind: 'local' | 'cloud' = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/.test(
  env.supabaseUrl,
)
  ? 'local'
  : 'cloud'
