import { buildPush, deliver, drain, ensureFunctionsServed, uniqueWord, type Push } from './ingest'
import { expect, login, PERSONAS, rpc, test, toast } from './helpers'

/**
 * Inbox → log → projection, seen from the UI:
 *   a push is signed and POSTed to the local github-webhook function (scripts/replay_webhooks.py),
 *   the worker drains the queue (app.worker --once), project_push writes the contribution, and
 *   the contribution trigger broadcasts on the private channel project:P01, which ramesh's
 *   rubric sheet is subscribed to. Then search finds the new note, under RLS.
 */
const MEERA = PERSONAS.meera.usn
const NOTE_WORD = uniqueWord('kestrel') // in T01's new vault note (P01)
const T00_WORD = uniqueWord('ptarmigan') // in T00's new report (P06)

let served = false
let stopFunctions: () => void = () => {}

test.describe('10 · ingestion: replayed push → live toast → search', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const r = await ensureFunctionsServed()
    served = r.served
    stopFunctions = r.stop
  })
  test.afterAll(() => stopFunctions())

  test('ramesh: a projected push shows a live toast and a feed entry on /sheet/P01', async ({ page }) => {
    await login(page, 'ramesh')
    await page.goto('/sheet/P01')
    await expect(page.getByTestId('rubric-grid')).toBeVisible()
    const feed = page.getByTestId('activity-feed')
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-status', 'live', { timeout: 30_000 })

    const push: Push = buildPush({
      template: 't01_push_02.json',
      author: { name: 'Meera Iyer', email: 'meera.cy24@rvce.edu.in', username: 'meera-iyer' },
      path: `shared/E2E ${NOTE_WORD}.md`,
      message: `Vault: E2E ${NOTE_WORD} decisions`,
      content: `# E2E ${NOTE_WORD}\n\nWe record the ${NOTE_WORD} decision: every TEAM_MEMBER row needs a STUDENT and a TEAM, so the relationship is total on both sides.\n`,
    })
    const via = await deliver(push, served)
    const by = await drain(push)
    test.info().annotations.push({ type: 'ingest', description: `inbox: ${via}; worker: ${by}` })
    console.log(`[10] inbox: ${via}; worker: ${by}`)

    const line = toast(page, `New evidence: ${MEERA} · E2E ${NOTE_WORD} · github`)
    await expect(line).toBeVisible({ timeout: 30_000 })
    const item = feed.locator('[data-testid="activity-item"][data-live="true"]').filter({ hasText: `E2E ${NOTE_WORD}` })
    await expect(item).toBeVisible()
    await expect(item).toContainText(MEERA)
    // metadata only: the note text never reaches the faculty page
    await expect(page.locator('body')).not.toContainText('relationship is total on both sides')

    // drill down: the push behind the live item, Mongo raw event next to the Postgres rows
    await item.getByTestId('trace-open').click()
    const sheet = page.getByTestId('trace-sheet')
    await expect(sheet).toBeVisible()
    const mongoHalf = sheet.getByTestId('trace-mongo')
    const offline = sheet.getByText('API offline')
    await expect(mongoHalf.or(offline).first()).toBeVisible({ timeout: 20_000 })
    if (await mongoHalf.isVisible()) {
      test.info().annotations.push({ type: 'trace', description: 'GET /ingest/trace answered' })
      await expect(mongoHalf).toContainText(push.delivery)
      await expect(sheet.getByTestId('trace-postgres')).toContainText(push.delivery)
      const commit = sheet.getByTestId('trace-commit').first()
      await expect(commit).toHaveAttribute('data-status', 'matched')
      await expect(commit).toContainText(MEERA)
      await expect(sheet).not.toContainText('relationship is total on both sides')
    } else {
      test.info().annotations.push({ type: 'trace', description: 'API offline state' })
    }
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
  })

  test('meera: search finds the new note, the Activity tab lists the commit', async ({ page }) => {
    await login(page, 'meera')
    await page.goto(`/search?q=${NOTE_WORD}`)
    const card = page.getByTestId('search-result').filter({ hasText: `E2E ${NOTE_WORD}` })
    await expect(card).toBeVisible()
    await expect(card.locator('mark').first()).toHaveText(new RegExp(NOTE_WORD, 'i'))
    await expect(card.getByTestId('score-breakdown')).toContainText('FTS rank')
    await expect(card.getByTestId('score-breakdown')).toContainText('RRF')

    // the SQL drawer shows the function that ran
    await page.locator('[data-sql-panel="search.chunks"]').first().click()
    const sheet = page.getByRole('dialog').filter({ hasText: 'Show the SQL' })
    await expect(sheet).toContainText('search_chunks')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // Ask: an answer with citations (API up), or the graceful offline state
    await page.getByTestId('ask-input').fill(`What did we decide about ${NOTE_WORD}?`)
    await page.getByTestId('ask-submit').click()
    const answer = page.getByTestId('ask-answer')
    const offline = page.getByText(/Ask API offline|has no \/ask endpoint/)
    const askError = page.getByRole('alert')
    await expect(answer.or(offline).or(askError).first()).toBeVisible({ timeout: 45_000 })
    if (await answer.isVisible()) {
      test.info().annotations.push({ type: 'ask', description: 'answer from POST /ask' })
      await expect(answer.getByTestId('answer-citation').first()).toBeVisible()
    } else {
      test.info().annotations.push({ type: 'ask', description: (await offline.isVisible()) ? 'offline state' : 'API error state' })
    }

    await page.goto('/projects/P01?tab=activity')
    const commit = page.getByTestId('commit').filter({ hasText: `E2E ${NOTE_WORD} decisions` })
    await expect(commit).toBeVisible()
    await expect(commit).toContainText(`shared/E2E ${NOTE_WORD}.md`)
  })

  test('lakshmi: search returns nothing for P06, while T00 itself finds its text', async ({ page }) => {
    const push = buildPush({
      template: 't00_push_01.json',
      author: { name: 'Arun Sanjay', email: '228202223+Arun-Sanjay@users.noreply.github.com', username: 'Arun-Sanjay' },
      path: `docs/e2e-${T00_WORD}.md`,
      message: `docs: ${T00_WORD} design note`,
      content: `# ${T00_WORD}\n\nThe ${T00_WORD} note explains how the countersign queue is ordered.\n`,
    })
    await deliver(push, served)
    await drain(push)

    // positive control: a member of T00 (P06) finds it
    const mine = await rpc('arun', 'search_chunks', { p_query: T00_WORD })
    expect(mine.status).toBe(200)
    expect((mine.body as unknown as { project_id: string }[]).map((r) => r.project_id)).toContain('P06')

    // lakshmi teaches only P02: RLS returns nothing, with or without a team filter
    for (const args of [{ p_query: T00_WORD }, { p_query: T00_WORD, p_team_id: 'T00' }, { p_query: 'countersign queue ordered' }]) {
      const r = await rpc('lakshmi', 'search_chunks', args)
      expect(r.status).toBe(200)
      expect((r.body as unknown as { project_id: string }[]).filter((x) => x.project_id === 'P06')).toEqual([])
    }

    await login(page, 'lakshmi')
    await page.goto(`/search?q=${T00_WORD}`)
    await expect(page.getByText('No results visible to you')).toBeVisible()
    await expect(page.getByTestId('search-result')).toHaveCount(0)
    await expect(page.getByTestId('search-count')).toHaveText('0 results')
    // the team filter offers only teams she oversees: none of P06
    await page.getByRole('combobox', { name: 'Team filter' }).click()
    await expect(page.getByRole('option', { name: /T00/ })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /P06/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
