import { ARUN_C3_STATEMENT, expect, login, restGet, SOLO_TEAM_NOTE, test, toast } from './helpers'

interface ClaimRow {
  claim_id: number
  status: string
  milestone_no: number
  statement: string
  revision: number
}

test.describe('2 · arun: semester hub and filing a claim', () => {
  test('semester hub shows CD252IA', async ({ page }) => {
    await login(page, 'arun')
    await expect(page.getByText(/CD252IA/).first()).toBeVisible()
    await expect(page.getByText('CD252IA Lab 2026-27').first()).toBeVisible()
    // the product never calls anyone a "ghost"
    await expect(page.locator('body')).not.toContainText(/ghost/i)
  })

  test('files a claim on P06 component 3 with evidence', async ({ page }) => {
    await login(page, 'arun')
    await page.goto('/projects/P06')
    await expect(page.getByRole('tab', { name: /Components/ })).toBeVisible()

    await page.getByRole('button', { name: 'File a claim' }).first().click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'File a claim' })
    await expect(dlg).toBeVisible()

    // Component: C3 (ER Diagram)
    const combos = dlg.getByRole('combobox')
    await combos.nth(0).click()
    await page.getByRole('option', { name: /^C3\b/ }).click()
    await expect(combos.nth(0)).toContainText('C3')
    // Kind of work: design
    await combos.nth(1).click()
    await page.getByRole('option', { name: /design/i }).click()

    await dlg.locator('textarea').first().fill(ARUN_C3_STATEMENT)

    // Evidence 1: cite the team's ER diagram artifact (its latest version, same transaction)
    await dlg.getByRole('combobox').nth(3).click()
    await page.getByRole('option', { name: /A17/ }).click()
    // Evidence 2: a URL row
    await dlg.getByRole('button', { name: 'Add evidence' }).click()
    await dlg.getByPlaceholder('https://…').fill('https://example.org/countersign/er-v2-review')

    await dlg.getByRole('button', { name: 'File claim' }).click()
    const done = toast(page, /Claim #\d+ filed for C3/)
    await expect(done).toBeVisible()
    const claimId = Number(/#(\d+)/.exec((await done.textContent()) ?? '')?.[1])
    expect(claimId).toBeGreaterThan(0)

    // My claims tab shows it pending, with both pieces of evidence
    await page.getByRole('tab', { name: /My claims/ }).click()
    const card = page.locator(`[data-claim="${claimId}"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText(ARUN_C3_STATEMENT)
    await expect(card.locator('[data-status="pending"]')).toBeVisible()
    await expect(card).toContainText('Evidence (2)')
    await expect(card).toContainText('https://example.org/countersign/er-v2-review')
    // T00 is a solo team: nobody can countersign, and the card says so
    await expect(card.getByTestId('solo-team-note')).toHaveText(SOLO_TEAM_NOTE)

    // and the database agrees (read as arun, under RLS)
    const rows = await restGet<ClaimRow>('arun', `claim?select=claim_id,status,milestone_no,statement,revision&claim_id=eq.${claimId}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', milestone_no: 3, statement: ARUN_C3_STATEMENT })
    const evidence = await restGet('arun', `claim_evidence?select=evidence_no,kind,artifact_id,ref&claim_id=eq.${claimId}&order=evidence_no`)
    expect(evidence).toEqual([
      expect.objectContaining({ evidence_no: 1, kind: 'artifact_version', artifact_id: 'A17' }),
      expect.objectContaining({ evidence_no: 2, kind: 'url', ref: 'https://example.org/countersign/er-v2-review' }),
    ])
  })
})
