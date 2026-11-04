import { expect, login, PASSWORD, PERSONAS, test, type PersonaKey } from './helpers'

test.describe('1 · login and landing page', () => {
  test('login page shows the product, tagline and subtitle', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Sign in to Countersign')).toBeVisible()
    await expect(page.getByText('Unified Experiential Learning Platform — RVCE CD252IA')).toBeVisible()
    await expect(page.getByText(/every mark has a receipt/i).first()).toBeVisible()
  })

  test('a wrong password shows a friendly error, not a raw auth error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('arun@example.edu')
    await page.getByLabel('Password').fill(`${PASSWORD}-wrong`)
    await page.getByTestId('sign-in').click()
    await expect(page.getByText('Check your email and password and try again.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  for (const who of Object.keys(PERSONAS) as PersonaKey[]) {
    test(`${who} signs in and lands on ${PERSONAS[who].home}`, async ({ page }) => {
      await login(page, who)
      await expect(page).toHaveURL(new RegExp(`${PERSONAS[who].home}$`))
      // the landing page rendered something real, not a guard explanation or a blank shell
      await expect(page.getByText(/This page is for .* accounts/)).toHaveCount(0)
      await expect(page.getByText('This login is not linked to a profile')).toHaveCount(0)
      await expect(page.locator('h1').first()).toBeVisible()
    })
  }

  test('signed-out visitors are sent to /login with a return link', async ({ page }) => {
    await page.goto('/sheet/P06')
    await expect(page).toHaveURL(/\/login\?next=%2Fsheet%2FP06/)
  })
})
