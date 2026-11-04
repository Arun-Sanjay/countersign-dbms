import { expect, login, test } from './helpers'

const ARUN_PRIVATE_NOTE = 'Race finding to explain'

test.describe('7 · arun’s privacy and the role guard', () => {
  test('his private note is not shown on /faculty-view', async ({ page }) => {
    await login(page, 'arun')
    // the note exists and is his (visible on /notes) ...
    await page.goto('/notes')
    await expect(page.getByText(ARUN_PRIVATE_NOTE).first()).toBeVisible()

    // ... but "what my faculty sees" never lists it
    await page.goto('/faculty-view')
    const visible = page.locator('section, div').filter({ has: page.getByText('Visible to your faculty', { exact: true }) }).last()
    await expect(page.getByText('Visible to your faculty', { exact: true })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible()
    await expect(visible).not.toContainText(ARUN_PRIVATE_NOTE)
    await expect(page.locator('body')).not.toContainText(ARUN_PRIVATE_NOTE)
    await expect(page.locator('body')).not.toContainText('RR snapshot is taken before the lock wait')
    // it is counted in the "never shown to faculty" panel instead
    await expect(page.getByText('Never shown to faculty', { exact: true })).toBeVisible()
    await expect(page.getByText(/1\s*private note\b/)).toBeVisible()
  })

  for (const path of ['/sheet/P06', '/contested', '/marks/P06', '/teaching']) {
    test(`arun cannot reach the faculty route ${path}`, async ({ page }) => {
      await login(page, 'arun')
      await page.goto(path)
      await expect(page.getByText('This page is for faculty / admin accounts')).toBeVisible()
      await expect(page.getByTestId('rubric-grid')).toHaveCount(0)
      await expect(page.locator('[data-cell]')).toHaveCount(0)
    })
  }

  test('arun cannot reach /admin', async ({ page }) => {
    await login(page, 'arun')
    await page.goto('/admin')
    await expect(page.getByText('This page is for admin accounts')).toBeVisible()
  })
})
