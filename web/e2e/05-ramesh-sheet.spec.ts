import { expect, login, PERSONAS, restGet, rpc, test, toast } from './helpers'

const MEERA = PERSONAS.meera.usn
const cell = (usn: string, no: number) => `[data-cell="${usn}:${no}"]`

test.describe('5 · ramesh: the P06 rubric sheet', () => {
  test.describe.configure({ mode: 'serial' })

  test('opens /sheet/P06 with every student, the totals and "No recorded evidence yet"', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    const grid = page.getByTestId('rubric-grid')
    await expect(grid).toBeVisible()
    for (const name of ['S Arun Sanjay', 'Sanvid Razdan', 'Aditi Rao', 'Karthik M', 'Meera Iyer']) {
      await expect(grid.getByText(name, { exact: true })).toBeVisible()
    }
    await expect(grid).toContainText('/120')
    await expect(grid).toContainText('/50')
    await expect(page.getByText('No recorded evidence yet').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/ghost/i)
  })

  test('enters a mark on C2 within the max, then is stopped above the max', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    await page.locator(cell(MEERA, 2)).click()
    const drawer = page.getByRole('dialog').filter({ hasText: 'Requirement Specification' })
    await expect(drawer).toBeVisible()
    const marks = drawer.getByLabel('Marks (0–5)')
    await expect(marks).toBeVisible()

    await marks.fill('4')
    await drawer.getByRole('button', { name: /Record mark|Update mark/ }).click()
    await expect(toast(page, 'C2 recorded: 4 / 5')).toBeVisible()
    await expect(page.locator(cell(MEERA, 2))).toContainText('4')

    // over the max: the field error, and nothing changes in the database
    await marks.fill('7')
    await drawer.getByRole('button', { name: /Update mark|Record mark/ }).click()
    await expect(drawer.getByRole('alert')).toContainText('The maximum for this component is 5.')
    const rows = await restGet<{ marks: number }>('ramesh', `assessment?select=marks&usn=eq.${MEERA}&project_id=eq.P06&milestone_no=eq.2`)
    expect(rows.map((r) => Number(r.marks))).toEqual([4])
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  })

  test('entry mode also refuses a mark above the max', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    await page.getByTestId('entry-toggle').click()
    const input = page.getByRole('textbox', { name: /Meera Iyer, C2 / })
    await input.fill('9')
    await input.press('Enter')
    await expect(toast(page, 'Check the marks')).toContainText('The maximum for this component is 5.')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const rows = await restGet<{ marks: number }>('ramesh', `assessment?select=marks&usn=eq.${MEERA}&project_id=eq.P06&milestone_no=eq.2`)
    expect(rows.map((r) => Number(r.marks))).toEqual([4])
  })

  test('the database itself refuses a mark above the max (not only the form)', async () => {
    const r = await rpc('ramesh', 'record_assessment', { p_usn: MEERA, p_project_id: 'P06', p_milestone_no: 2, p_marks: 7 })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(r.body)).toMatch(/max/i)
  })

  test('locks C2 and the column is shaded', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    await expect(page.getByTestId('rubric-grid')).toBeVisible()
    await page.getByTestId('lock-2').click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Lock C2')
    await confirm.getByRole('button', { name: 'Lock component' }).click()
    await expect(toast(page, 'C2 locked')).toBeVisible()

    // header: lock icon instead of the lock button; cells: hatched background
    await expect(page.getByTestId('lock-2')).toHaveCount(0)
    const td = page.locator(cell(MEERA, 2)).locator('xpath=..')
    await expect(td).toHaveAttribute('style', /repeating-linear-gradient/)
    await expect(td).toHaveClass(/bg-muted/)
    // an open component next to it is not shaded
    await expect(page.locator(cell(MEERA, 3)).locator('xpath=..')).not.toHaveAttribute('style', /repeating-linear-gradient/)

    // persists across a reload, and the DB is locked
    await page.reload()
    await expect(page.locator(cell(MEERA, 2)).locator('xpath=..')).toHaveAttribute('style', /repeating-linear-gradient/)
    const ms = await restGet<{ locked_at: string | null }>('ramesh', 'milestone?select=locked_at&project_id=eq.P06&milestone_no=eq.2')
    expect(ms[0]?.locked_at).not.toBeNull()

    // entry mode keeps locked cells read-only
    await page.getByTestId('entry-toggle').click()
    await expect(page.getByRole('textbox', { name: /Meera Iyer, C2 / })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: /Meera Iyer, C3 / })).toBeVisible()
  })
})
