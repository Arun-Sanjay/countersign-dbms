import { ARUN_C3_STATEMENT, expect, login, PERSONAS, restGet, test, toast } from './helpers'

test.describe('3 · sanvid countersigns arun’s claim', () => {
  test('sees arun’s pending C3 claim and confirms it; ramesh’s open sheet refreshes on focus', async ({ page, browser }) => {
    // set up by 02: arun's pending C3 claim
    const pending = await restGet<{ claim_id: number; status: string }>(
      'sanvid',
      `claim?select=claim_id,status&usn=eq.${PERSONAS.arun.usn}&project_id=eq.P06&milestone_no=eq.3`,
    )
    expect(pending, 'arun’s C3 claim from spec 02 must exist').toHaveLength(1)
    const claimId = pending[0]!.claim_id
    expect(pending[0]!.status).toBe('pending')

    // KNOWN_ISSUES #5: ramesh already has the sheet open in another window
    const facultyCtx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 1000 } })
    const faculty = await facultyCtx.newPage()
    await login(faculty, 'ramesh')
    await faculty.goto('/sheet/P06')
    const arunC3 = faculty.locator(`[data-cell="${PERSONAS.arun.usn}:3"]`)
    await expect(arunC3).toHaveAttribute('aria-label', /claims: 1 pending/)

    await login(page, 'sanvid')
    await page.goto('/projects/P06')
    await page.getByRole('tab', { name: /Countersign/ }).click()

    const card = page.locator(`[data-claim="${claimId}"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText(PERSONAS.arun.name)
    await expect(card).toContainText(ARUN_C3_STATEMENT)
    await expect(card.locator('[data-status="pending"]')).toBeVisible()

    await card.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm claim' }).click()
    await expect(toast(page, `Confirmed claim #${claimId}`)).toBeVisible()
    await expect(toast(page, `Confirmed claim #${claimId}`)).toContainText('confirmed')

    // the status is derived by trigger
    const after = await restGet<{ status: string }>('sanvid', `claim?select=status&claim_id=eq.${claimId}`)
    expect(after[0]?.status).toBe('confirmed')
    const signs = await restGet('sanvid', `countersign?select=endorser_usn,verdict&claim_id=eq.${claimId}`)
    expect(signs).toEqual([{ endorser_usn: PERSONAS.sanvid.usn, verdict: 'confirm' }])

    // back to the faculty window: it refetches the sheet on focus, no reload needed
    await faculty.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(arunC3).toHaveAttribute('aria-label', /claims: 1 confirmed/)
    await facultyCtx.close()
  })

  test('arun now sees the claim as confirmed and frozen', async ({ page }) => {
    const [row] = await restGet<{ claim_id: number }>(
      'arun',
      `claim?select=claim_id&usn=eq.${PERSONAS.arun.usn}&project_id=eq.P06&milestone_no=eq.3`,
    )
    expect(row).toBeDefined()
    await login(page, 'arun')
    await page.goto('/projects/P06')
    await page.getByRole('tab', { name: /My claims/ }).click()
    const card = page.locator(`[data-claim="${row!.claim_id}"]`)
    await expect(card.locator('[data-status="confirmed"]')).toBeVisible()
    await expect(card.getByRole('button', { name: /Add evidence/ })).toHaveCount(0)
  })
})
