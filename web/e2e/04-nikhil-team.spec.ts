import { expect, login, PERSONAS, restGet, test, toast } from './helpers'

test.describe('4 · nikhil joins a team', () => {
  test('a full team gives a friendly "team full" error', async ({ page }) => {
    await login(page, 'nikhil')
    await page.goto('/team?project=P01')
    const t01 = page.locator('[data-team="T01"]')
    await expect(t01).toBeVisible()
    await t01.getByRole('button', { name: /Join/ }).click()
    const alert = t01.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Team is full')
    await expect(alert).toContainText('4 of 4')
    // friendly, not the raw trigger text
    await expect(alert).not.toContainText('RAISE')
    expect(await restGet('nikhil', `team_member?select=usn&team_id=eq.T01&usn=eq.${PERSONAS.nikhil.usn}`)).toHaveLength(0)
  })

  test('joins a team with space in an eligible project (P01 / T02)', async ({ page }) => {
    await login(page, 'nikhil')
    await page.goto('/team?project=P01')
    const t02 = page.locator('[data-team="T02"]')
    await expect(t02).toContainText('3 / 4')
    await t02.getByRole('button', { name: /Join/ }).click()
    await expect(toast(page, 'Joined Team Beta')).toBeVisible()
    await expect(t02).toContainText('Your team')
    await expect(t02).toContainText('4 / 4')
    expect(await restGet('nikhil', `team_member?select=usn&team_id=eq.T02&usn=eq.${PERSONAS.nikhil.usn}`)).toHaveLength(1)
  })

  test('joining a team of a project he is not enrolled for shows the enrollment error', async ({ page }) => {
    // P06 belongs to the section-A offering of CD252IA; nikhil is in section B. T06 has space (3 / 4).
    await login(page, 'nikhil')
    await page.goto('/team?project=P06')
    const t06 = page.locator('[data-team="T06"]')
    await expect(t06).toBeVisible()
    await expect(t06).toContainText('3 / 4')
    await t06.getByRole('button', { name: /Join/ }).click()
    const alert = t06.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Enrollment required')
    expect(await restGet('nikhil', `team_member?select=usn&team_id=eq.T06&usn=eq.${PERSONAS.nikhil.usn}`)).toHaveLength(0)
  })
})
