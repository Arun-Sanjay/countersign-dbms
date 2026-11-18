import { expect, login, restGet, test } from './helpers'

test.describe('6 · lakshmi (teaches another course) cannot see P06', () => {
  test('/sheet/P06 shows no rows and no student data', async ({ page }) => {
    await login(page, 'lakshmi')
    await page.goto('/sheet/P06')
    await expect(page.getByText('No rows visible to you')).toBeVisible()
    await expect(page.locator('[data-cell]')).toHaveCount(0)
    for (const name of ['S Arun Sanjay', 'Aditi Rao', 'Karthik M', 'Meera Iyer']) {
      await expect(page.getByText(name)).toHaveCount(0)
    }
  })

  test('her landing page lists only the project she teaches', async ({ page }) => {
    await login(page, 'lakshmi')
    await expect(page.getByTestId('project-P02')).toBeVisible()
    await expect(page.getByTestId('project-P06')).toHaveCount(0)
  })

  test('RLS returns nothing for P06 to her', async () => {
    expect(await restGet('lakshmi', 'v_rubric_sheet?select=usn&project_id=eq.P06')).toEqual([])
    expect(await restGet('lakshmi', 'assessment?select=usn&project_id=eq.P06')).toEqual([])
    expect(await restGet('lakshmi', 'claim?select=claim_id&project_id=eq.P06')).toEqual([])
  })
})
