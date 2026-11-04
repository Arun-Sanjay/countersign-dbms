import { closeSheet, expect, login, openSql, test } from './helpers'

/**
 * 11 · /race, the Race arena (Component 10 inside the product).
 * The reported results are built into the page, so the page renders without the API. The live
 * panel is checked against a mocked API (race lab offline, API down, one result), so the spec
 * never depends on the elp-race-pg container or on timing.
 */
const OFFLINE = {
  detail: {
    code: 'race_lab_offline',
    message:
      'Race lab offline: no PostgreSQL answered (ConnectionRefusedError) at localhost:55433/race. Start it with experiments/race/setup.sh (container elp-race-pg, port 55433, about 5 s), then try again.',
  },
}

const ONE_RACE = {
  strategy: 'S2',
  isolation: 'RR',
  isolation_name: 'REPEATABLE READ',
  n: 2,
  admitted: 2,
  refused: 0,
  aborted: 0,
  errors: 0,
  aborts_40001: 0,
  retries: 0,
  final_size: 5,
  max_size: 4,
  over_admitted: true,
  duration_ms: 4.1,
  clients: [
    { client_no: 1, outcome: 'admitted', sqlstate: null, latency_ms: 3.9, retries: 0 },
    { client_no: 2, outcome: 'admitted', sqlstate: null, latency_ms: 2.7, retries: 0 },
  ],
  schedule: [
    { seq: 101, txn: 'T1', op: 'r', item: 'team:T02' },
    { seq: 102, txn: 'T1', op: 'r', item: 'members:T02' },
    { seq: 201, txn: 'T2', op: 'r', item: 'team:T02' },
    { seq: 202, txn: 'T2', op: 'r', item: 'members:T02' },
    { seq: 401, txn: 'T2', op: 'w', item: 'members:T02' },
    { seq: 601, txn: 'T2', op: 'c', item: null },
    { seq: 701, txn: 'T1', op: 'w', item: 'members:T02' },
    { seq: 901, txn: 'T1', op: 'c', item: null },
  ],
  lab: 'localhost:55433/race',
}

test.describe('11 · /race: the Race arena', () => {
  test('faculty: matrix, latency, strategies, precedence graphs and the SQL drawer render', async ({ page }) => {
    await login(page, 'ramesh')
    await page.getByRole('link', { name: 'Race arena' }).click()
    await page.waitForURL('**/race')
    await expect(page.getByRole('heading', { name: 'Race arena: the last team slot' })).toBeVisible()
    await expect(page.getByTestId('race-headline')).toContainText('only correct at READ COMMITTED')

    // the matrix: 6 strategies x 3 isolation levels x 4 N
    const heatmap = page.getByTestId('race-heatmap')
    await expect(heatmap.locator('button[data-cell]')).toHaveCount(72)
    await expect(heatmap.locator('[data-cell="S2-RR-100"]')).toContainText('100%')
    await expect(heatmap.locator('[data-cell="S6-RR-100"]')).toContainText('0%')
    await heatmap.locator('[data-cell="S1-SER-32"]').click()
    await expect(page.getByTestId('race-cell-detail')).toContainText('S1 · SERIALIZABLE · N = 32')
    await expect(page.getByTestId('race-cell-detail')).toContainText('40001 serialization failure')

    // latency: chart, and the same numbers as a table
    await expect(page.getByTestId('race-latency-chart')).toBeVisible()
    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    await expect(page.getByTestId('race-latency-table').locator('tbody tr')).toHaveCount(6)

    // strategy cards with their SQL
    await expect(page.getByTestId('strategy-cards').locator('article')).toHaveCount(6)
    const s6 = page.getByTestId('strategy-S6')
    await s6.getByRole('button', { name: /exp\.team_seat_slot/ }).click()
    await expect(s6).toContainText('PRIMARY KEY (team_id, seat_no)')

    // the worked example: one cyclic, one acyclic N = 2 schedule
    await expect(page.getByTestId('example-cyclic').getByTestId('precedence-verdict')).toContainText('NOT conflict-serializable')
    await expect(page.getByTestId('example-cyclic').locator('svg title')).toHaveText(/T1 to T2, T2 to T1/)
    await expect(page.getByTestId('example-acyclic').getByTestId('precedence-verdict')).toContainText(/^conflict-serializable/)
    await expect(page.getByTestId('example-acyclic')).toContainText('w2(members:T02) < r1(members:T02)')

    // the "</> SQL" drawer: strategy SQL (verbatim fixture Q35) and the precedence-graph SQL
    let sheet = await openSql(page, 'race.S2')
    await expect(sheet).toContainText('CREATE OR REPLACE FUNCTION check_team_capacity()')
    await expect(sheet).toContainText('supabase/fixture/03_queries.sql')
    await closeSheet(page, sheet)
    sheet = await openSql(page, 'race.precedence')
    await expect(sheet).toContainText('CREATE OR REPLACE VIEW exp.v_precedence_edge_scoped')
    await expect(sheet).toContainText('WITH RECURSIVE')
    await closeSheet(page, sheet)
  })

  test('live panel: race lab offline (503) explains how to start it', async ({ page }) => {
    await page.route(/:8000\/race\/run$/, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(OFFLINE) }),
    )
    await login(page, 'admin')
    await page.goto('/race')
    const live = page.getByTestId('live-race')
    await live.getByTestId('run-race').click()
    await expect(live.getByText('Race lab offline', { exact: true })).toBeVisible()
    await expect(live.getByText('experiments/race/setup.sh', { exact: true })).toBeVisible()
    await expect(live.getByRole('button', { name: /Try again/ })).toBeVisible()
  })

  test('live panel: the API down is reported as API offline', async ({ page }) => {
    await page.route(/:8000\//, (route) => route.abort('connectionrefused'))
    await login(page, 'ramesh')
    await page.goto('/race')
    await page.getByTestId('run-race').click()
    await expect(page.getByTestId('live-race').getByText('API offline')).toBeVisible()
    // the reported results do not need the API
    await expect(page.getByTestId('race-heatmap').locator('button[data-cell]')).toHaveCount(72)
  })

  test('live panel: a result animates the clients and draws the live precedence graph', async ({ page }) => {
    await page.route(/:8000\/race\/run$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONE_RACE) }),
    )
    await login(page, 'ramesh')
    await page.goto('/race')
    const live = page.getByTestId('live-race')
    await live.getByRole('tab', { name: '2', exact: true }).click()
    await live.getByTestId('run-race').click()
    await expect(live.getByTestId('race-clients').locator('[data-outcome="admitted"]')).toHaveCount(2)
    await expect(live.getByTestId('race-final-size')).toContainText('Final size 5/4')
    await expect(live.getByTestId('live-precedence').getByTestId('precedence-verdict')).toContainText('NOT conflict-serializable')
  })

  test('student: the page is open, running a race is not', async ({ page }) => {
    await login(page, 'arun')
    await page.goto('/race')
    await expect(page.getByRole('heading', { name: 'Race arena: the last team slot' })).toBeVisible()
    await expect(page.getByTestId('run-race')).toBeDisabled()
    await expect(page.getByTestId('race-staff-only')).toBeVisible()
  })
})
