import { expect, login, test } from './helpers'

const apiStarted = process.env.E2E_API_STARTED === '1'

test.describe('9 · /notes: team notes from the API, or the offline state', () => {
  test('team notes render (API up) or the panel explains the API is offline', async ({ page }) => {
    await login(page, 'arun')
    await page.goto('/notes')
    await expect(page.getByText('Race finding to explain').first()).toBeVisible()
    await expect(page.getByText('Team notes', { exact: true })).toBeVisible()

    const offline = page.getByText('API offline')
    const picker = page.getByRole('combobox', { name: 'Team' })
    await expect(offline.or(picker).first()).toBeVisible()

    if (await offline.isVisible()) {
      test.info().annotations.push({ type: 'notes', description: 'API offline state' })
      expect(apiStarted, 'the API was started for this run but the page says it is offline').toBe(false)
      await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible()
      await expect(page.getByText('uv run uvicorn app.main:app --port 8000')).toBeVisible()
      return
    }

    test.info().annotations.push({ type: 'notes', description: 'team notes from the API' })
    await picker.click()
    await page.getByRole('option', { name: /T01/ }).click()
    await expect(page.getByText('Synopsis outline')).toBeVisible()
    await expect(page.getByText(/you read them as a team member/)).toBeVisible()
    // a teammate's draft is never shown, only final notes plus my own drafts
    await page.getByRole('button', { name: /version receipt/ }).first().click()
    await expect(page.getByText(/sha256 [0-9a-f]{12}/).first()).toBeVisible()
  })

  test('the offline state is shown when the API cannot be reached', async ({ page }) => {
    // Simulate the API being down regardless of whether it runs.
    await page.route(/:8000\//, (route) => route.abort('connectionrefused'))
    await login(page, 'arun')
    await page.goto('/notes')
    await expect(page.getByText('API offline')).toBeVisible()
    await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible()
    // private notes still work: they live in Postgres
    await expect(page.getByText('Race finding to explain').first()).toBeVisible()
  })
})
