import { ADITI, ARUN_C3_STATEMENT, expect, login, PERSONAS, restGet, SOLO_TEAM_NOTE, test, toast } from './helpers'

interface ClaimRow {
  claim_id: number
  status: string
  statement: string
}

test.describe('3 · meera countersigns a teammate’s claim; arun’s solo team has nobody to', () => {
  test('sees aditi’s pending C4 claim and confirms it; ramesh’s open sheet refreshes on focus', async ({ page, browser }) => {
    // seeded: Aditi (T06 lead) has one pending C4 claim with evidence and no countersign
    const pending = await restGet<ClaimRow>(
      'meera',
      `claim?select=claim_id,status,statement&usn=eq.${ADITI.usn}&project_id=eq.P06&milestone_no=eq.4&status=eq.pending`,
    )
    expect(pending, 'the demo seed must give aditi one pending C4 claim').toHaveLength(1)
    const claimId = pending[0]!.claim_id
    const statement = pending[0]!.statement
    expect(await restGet('meera', `countersign?select=endorser_usn&claim_id=eq.${claimId}`)).toEqual([])
    expect(
      await restGet('meera', `claim_evidence?select=evidence_no&claim_id=eq.${claimId}`),
      'the claim is backed by evidence',
    ).not.toHaveLength(0)

    // KNOWN_ISSUES #5: ramesh already has the sheet open in another window
    const facultyCtx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 1000 } })
    const faculty = await facultyCtx.newPage()
    await login(faculty, 'ramesh')
    await faculty.goto('/sheet/P06')
    const aditiC4 = faculty.locator(`[data-cell="${ADITI.usn}:4"]`)
    await expect(aditiC4).toHaveAttribute('aria-label', /claims: .*\b1 pending\b/)

    await login(page, 'meera')
    await page.goto('/projects/P06')
    await page.getByRole('tab', { name: /Countersign/ }).click()

    const card = page.locator(`[data-claim="${claimId}"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText(ADITI.name)
    await expect(card).toContainText(statement)
    await expect(card.locator('[data-status="pending"]')).toBeVisible()

    await card.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm claim' }).click()
    await expect(toast(page, `Confirmed claim #${claimId}`)).toBeVisible()
    await expect(toast(page, `Confirmed claim #${claimId}`)).toContainText('confirmed')

    // the status is derived by trigger
    const after = await restGet<{ status: string }>('meera', `claim?select=status&claim_id=eq.${claimId}`)
    expect(after[0]?.status).toBe('confirmed')
    const signs = await restGet('meera', `countersign?select=endorser_usn,verdict&claim_id=eq.${claimId}`)
    expect(signs).toEqual([{ endorser_usn: PERSONAS.meera.usn, verdict: 'confirm' }])
    // and it has left her queue
    await expect(page.locator(`[data-claim="${claimId}"] [data-status="pending"]`)).toHaveCount(0)

    // back to the faculty window: it refetches the sheet on focus, no reload needed
    await faculty.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(aditiC4).not.toHaveAttribute('aria-label', /pending/)
    await expect(aditiC4).toHaveAttribute('aria-label', /claims: .*confirmed/)
    await facultyCtx.close()
  })

  test('arun’s solo team: his claims stay pending and the UI says there is no teammate to countersign', async ({ page }) => {
    // T00 has exactly one member
    expect(await restGet('arun', 'team_member?select=usn&team_id=eq.T00')).toEqual([{ usn: PERSONAS.arun.usn }])
    const mine = await restGet<ClaimRow>('arun', `claim?select=claim_id,status,statement&usn=eq.${PERSONAS.arun.usn}&project_id=eq.P06`)
    expect(mine.length).toBeGreaterThan(0)
    for (const c of mine) expect(c.status, `claim #${c.claim_id}`).toBe('pending')
    const filed = mine.find((c) => c.statement === ARUN_C3_STATEMENT)
    expect(filed, 'arun’s C3 claim from spec 02 must exist').toBeDefined()

    await login(page, 'arun')
    await page.goto('/projects/P06')
    await page.getByRole('tab', { name: /My claims/ }).click()
    const card = page.locator(`[data-claim="${filed!.claim_id}"]`)
    await expect(card.locator('[data-status="pending"]')).toBeVisible()
    await expect(card.getByTestId('solo-team-note')).toHaveText(SOLO_TEAM_NOTE)
    // still pending, so he can keep adding evidence
    await expect(card.getByRole('button', { name: /Add evidence/ })).toBeVisible()

    await page.getByRole('tab', { name: /Countersign/ }).click()
    await expect(page.getByText(/You are the only member of this team/)).toBeVisible()
  })

  test('ramesh’s claim drawer says the same for arun’s C3 claims', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    await page.locator(`[data-cell="${PERSONAS.arun.usn}:3"]`).click()
    const drawer = page.getByRole('dialog').filter({ hasText: 'Claims behind this cell' })
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText(ARUN_C3_STATEMENT)
    await expect(drawer.getByTestId('solo-team-note').first()).toHaveText(SOLO_TEAM_NOTE)
    await expect(drawer).not.toContainText('Waiting for a teammate')
  })
})
