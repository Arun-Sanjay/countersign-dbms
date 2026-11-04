import { closeSheet, expect, login, openSql, test } from './helpers'

test.describe('8 · the "Show the SQL" drawer', () => {
  test('opens with real SQL on student panels (hub, project, faculty-view)', async ({ page }) => {
    await login(page, 'arun')

    let sheet = await openSql(page, 'hub.overview')
    await expect(sheet).toContainText('CREATE FUNCTION public.semester_hub')
    await sheet.getByRole('tab', { name: /RLS/ }).click()
    // semester_hub() reads public.student (the policy list matches the tables it touches)
    await expect(sheet.getByText('student_select', { exact: true })).toBeVisible()
    await expect(sheet.getByText('app_user_select', { exact: true })).toHaveCount(0)
    await sheet.getByRole('tab', { name: /Algebra/ }).click()
    await expect(sheet.getByRole('tabpanel')).not.toBeEmpty()
    await closeSheet(page, sheet)

    await page.goto('/projects/P06')
    await page.getByRole('tab', { name: /Countersign/ }).click()
    sheet = await openSql(page, 'project.countersign_queue')
    await expect(sheet).toContainText(/SELECT|CREATE/)
    await expect(sheet).toContainText('countersign')
    await closeSheet(page, sheet)

    await page.goto('/faculty-view')
    sheet = await openSql(page, 'faculty_view.items')
    await expect(sheet).toContainText('v_what_faculty_sees')
    await expect(sheet).toContainText('security_invoker')
    await closeSheet(page, sheet)
  })

  test('opens with real SQL on faculty panels (rubric sheet, lab CIE)', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P06')
    let sheet = await openSql(page, 'faculty.rubric_sheet')
    await expect(sheet).toContainText('CREATE VIEW v_rubric_sheet')
    await closeSheet(page, sheet)

    await page.goto('/marks/P06')
    sheet = await openSql(page, 'faculty.lab_cie_marks')
    await expect(sheet).toContainText('v_lab_cie_marks')
    await closeSheet(page, sheet)
  })
})
