/** "2 confirmed, 1 pending": the claim counts of a cell, in words (for aria-labels and titles). */
export function claimSummary(confirmed: number, pending: number, contested: number): string {
  const parts = [
    [contested, 'contested'],
    [pending, 'pending'],
    [confirmed, 'confirmed'],
  ] as const
  const words = parts.filter(([n]) => n > 0).map(([n, s]) => `${n} ${s}`)
  return words.length ? `claims: ${words.join(', ')}` : 'no claims'
}
