import type { AiAssistance } from '@/lib/rules'

/** One vocabulary for the declared AI field, on every screen: "AI declared: none / assisted / generated". */
export const AI_DECLARED: Record<AiAssistance, string> = {
  none: 'AI declared: none',
  assisted: 'AI declared: assisted',
  generated: 'AI declared: generated',
}

export function aiDeclaredLabel(value: string | null | undefined): string {
  return value ? (AI_DECLARED[value as AiAssistance] ?? `AI declared: ${value}`) : 'AI declared: —'
}
