// Reads a JSON array of {code, message, details, hint} (a PostgREST error body) on stdin and
// prints, for each, what the web app shows: toAppError() from web/src/lib/errors.ts, unchanged.
// Run with cwd = web/ (so @supabase/supabase-js resolves). Node >= 23 strips the TypeScript types.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const errorsTs = path.resolve(import.meta.dirname, '../../../../web/src/lib/errors.ts')
const { toAppError, errorTag } = await import(pathToFileURL(errorsTs).href)
const input = JSON.parse(readFileSync(0, 'utf8'))
const out = input.map((e) => {
  const a = toAppError({ code: e.code ?? undefined, message: e.message ?? '', details: e.details ?? null, hint: e.hint ?? null })
  return { kind: a.kind, title: a.title, message: a.message, field: a.field ?? null, rule: a.rule ?? null, tag: errorTag(a) ?? null }
})
process.stdout.write(JSON.stringify(out))
