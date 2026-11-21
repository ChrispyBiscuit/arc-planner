// Every operation, against a throwaway plan file. Each test file runs in its own process, so ARC_DATA is fixed here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'arc-ops-'))
process.env.ARC_DATA = join(dir, 'plan.json')
const { OPS, run: rawRun, load, importPlan } = await import('../lib/ops.mjs')
const { today, addDays } = await import('../public/shared.js')

const used = new Set()
const run = (name, args, actor, opts) => (used.add(name), rawRun(name, args, actor, opts))
const D = today()

test('profile, areas, metrics and chapters', () => {
  run('update_profile', { name: 'Test', birthDate: '1990-07-01', lifeExpectancy: 85 })
  assert.throws(() => run('update_profile', { birthDate: '07/01/1990' }), /YYYY-MM-DD/)
  run('upsert_area', { id: 'money', name: 'Money', color: 'yellow', summary: 'Where money stands.' })
  run('upsert_area', { id: 'health', name: 'Health', color: 'green' })
  const m = run('upsert_metric', { name: 'Bodyweight', unit: 'lb', area: 'health', target: 190 })
  run('log_metric', { id: 'Bodyweight', date: addDays(D, -30), value: 230 })
  const after = run('log_metric', { id: m.id, date: D, value: 210 })
  assert.equal(after.latest, 210)
  assert.throws(() => run('log_metric', { id: 'Nope', value: 1 }), /No metric/)
  assert.equal(run('get_metrics').length, 1)
  const ph = run('upsert_phase', { title: 'Rebuild', startYear: 2026, endYear: 2027 })
  run('delete_phase', { id: ph.id })
  const extra = run('upsert_metric', { name: 'Temp' })
  run('delete_metric', { id: extra.id })
  assert.equal(load().metrics.length, 1)
})

let lifeId, yearId, monthId
test('structured goals: complete ones are active, incomplete ones from Claude become proposals', () => {
  const life = run('upsert_goal', { type: 'outcome', horizon: 'life', area: 'money', title: 'Debt free', noRequirements: true, proposal: { approach: 'Pay down' }, criteria: [{ kind: 'check', text: 'No debt', evidence: 'Statements' }] })
  lifeId = life.id
  assert.equal(life.quality, 'complete')
  assert.equal(life.status, 'active')
  assert.equal(life.origin, 'you')
  const dec = run('upsert_goal', { type: 'outcome', horizon: 'decade', period: '2020', parentId: lifeId, area: 'money', title: 'Emergency fund built', why: 'x', noRequirements: true, proposal: { approach: 'File' }, criteria: [{ kind: 'check', text: 'Fund at $10,000', evidence: 'Statement' }] })
  const yr = run('upsert_goal', { type: 'outcome', horizon: 'year', period: String(D.slice(0, 4)), parentId: dec.id, area: 'money', title: 'Professional engaged', why: 'x', noRequirements: true, proposal: { approach: 'Call' }, criteria: [{ kind: 'check', text: 'Letter signed', evidence: 'Letter' }] }, 'claude')
  yearId = yr.id
  assert.equal(yr.quality, 'complete')
  assert.equal(yr.status, 'active')
  assert.equal(yr.origin, 'claude')
  const half = run('upsert_goal', { horizon: 'month', period: D.slice(0, 7), parentId: yearId, title: 'Something vague' }, 'claude')
  assert.equal(half.status, 'proposed')
  assert.notEqual(half.quality, 'complete')
  monthId = half.id
  assert.throws(() => run('upsert_goal', { horizon: 'year', period: '2026', title: 'x', type: 'bogus' }), /type must be/)
  assert.throws(() => run('upsert_goal', { horizon: 'year', period: '2026', title: 'x', end: 'soon' }), /Bad end/)
  const listed = run('list_goals', { quality: 'complete' })
  assert.equal(listed.length, 3)
  assert.equal(run('list_goals', { status: 'proposed' }).length, 1)
  run('delete_goal', { id: monthId })
})

let taskId
test('tasks, criteria gating and closing', () => {
  const t = run('upsert_task', { type: 'action', title: 'Call the firm', goalId: yearId, why: 'x', noRequirements: true, proposal: { approach: 'Phone' }, criteria: [{ kind: 'date', text: 'Meeting booked', by: addDays(D, 7) }, { kind: 'check', text: 'Fee quoted', evidence: 'Email' }], date: D, end: addDays(D, 7), estimate: 30, priority: 'must' })
  taskId = t.id
  assert.equal(t.quality, 'complete')
  assert.equal(t.end, addDays(D, 7))
  const item = run('get_item', { ref: 't:' + taskId })
  assert.equal(item.parents.length, 3)
  assert.equal(item.criteriaMet, false)
  assert.throws(() => run('close_item', { ref: 't:' + taskId, status: 'done' }), (e) => e.code === 'CRITERIA' && e.unmet.length === 2)
  run('update_criterion', { ref: 't:' + taskId, criterionId: 'c2', met: true, evidence: 'Email from the firm' })
  assert.equal(run('check_criteria', { ref: 't:' + taskId }).criteria.filter((c) => c.met).length, 1)
  // Ticking the day's checkbox asserts the yes-or-no and date criteria and closes the task.
  run('set_item_status', { date: D, key: 't:' + taskId, status: 'done' })
  assert.equal(run('get_item', { ref: 't:' + taskId }).status, 'done')
  run('set_item_status', { date: D, key: 't:' + taskId, status: 'todo' })
  assert.equal(load().tasks.find((x) => x.id === taskId).status, 'active')
  // A metric criterion is not something a checkbox can assert.
  const m = load().metrics[0]
  const heavy = run('upsert_task', { title: 'Weigh in under 200', goalId: yearId, date: D, criteria: [{ kind: 'metric', text: 'Under 200', metricId: m.id, op: '<=', value: 200 }] })
  assert.throws(() => run('set_item_status', { date: D, key: 't:' + heavy.id, status: 'done' }), (e) => e.code === 'CRITERIA')
  const closed = run('close_item', { ref: 't:' + heavy.id, status: 'done', overrideReason: 'Weighed on another scale', outcome: 'Done anyway' })
  assert.equal(closed.status, 'done')
  assert.equal(closed.outcome.override, 'Weighed on another scale')
  run('close_item', { ref: 't:' + heavy.id, status: 'active' })
  const dropped = run('close_item', { ref: 't:' + heavy.id, status: 'dropped', lesson: 'Not needed' })
  assert.equal(dropped.effectiveStatus, 'dropped')
  run('delete_task', { id: heavy.id })
})

test('days: plan, check-in, performance', () => {
  const r = run('upsert_routine', { title: 'Study', area: 'money', days: [0, 1, 2, 3, 4, 5, 6], criterion: 'One section at 80%', goalId: yearId })
  assert.equal(run('list_routines').length, 1)
  const planned = run('plan_day', { date: D, brief: 'Focus', tasks: [{ title: 'Write notes', area: 'money' }] }, 'claude')
  assert.equal(planned.added[0].status, 'proposed')
  const day = run('check_in', { date: D, summary: 'Good day', sleepHours: 7, items: [{ title: 'Study', status: 'done', actual: '1 section' }, { title: 'Unplanned walk' }], metrics: [{ id: 'Bodyweight', value: 209 }] }, 'claude')
  assert.deepEqual(day.addedAsUnplanned, ['Unplanned walk'])
  assert.equal(day.items.find((i) => i.title === 'Study').status, 'done')
  assert.equal(run('get_day', { date: D }).checkin.summary, 'Good day')
  assert.equal(run('get_range', { from: addDays(D, -2), to: D }).length, 3)
  assert.throws(() => run('get_range', { from: '2020-01-01', to: '2026-01-01' }), /120 days/)
  const perf = run('get_performance', {})
  assert.ok(perf.byRoutine['r:' + r.id])
  const ov = run('get_overview', {})
  assert.ok(ov.planQuality.total > 0)
  assert.ok(Array.isArray(ov.excludedTopics))
  run('delete_routine', { id: r.id })
})

test('history, revisions, templates and lint report', () => {
  const f = run('add_fact', { date: '2026-08-06', area: 'money', title: 'Gave notice', kind: 'decision' })
  assert.equal(run('list_facts', { q: 'notice' }).length, 1)
  run('delete_fact', { id: f.id })
  run('log_revision', { summary: 'Re-planned money' })
  assert.equal(run('get_revisions', { limit: 1 })[0].summary, 'Re-planned money')
  assert.ok(run('get_templates').goal.outcome)
  const report = run('lint_plan', { list: true })
  assert.ok(report.items.length > 0)
})

test('excluded topics: Claude is refused, the user is not; the list is dashboard-only', () => {
  assert.deepEqual(run('get_policy').excluded, [])
  run('set_policy', { excluded: ['therapy', 'drinking', 'panic'] })
  assert.throws(() => run('upsert_task', { title: 'Book a therapy session' }, 'claude'), (e) => e.code === 'POLICY')
  assert.throws(() => run('add_fact', { title: 'x', detail: 'notes about Drinking' }, 'claude'), (e) => e.code === 'POLICY')
  // Words containing a term are not matched.
  run('add_fact', { title: 'Felt panicky, then fine' }, 'claude')
  assert.ok(run('get_policy').excluded.includes('therapy'))
  assert.throws(() => run('set_policy', { excluded: [] }, 'claude'), /dashboard/)
  run('set_policy', { excluded: ['therapy', 'motorcycle'] })
  assert.throws(() => run('add_fact', { title: 'Rode the motorcycle' }, 'claude'), (e) => e.code === 'POLICY')
  run('upsert_task', { title: 'Book a therapy session', goalId: yearId })
})

test('a write based on an old revision is refused', () => {
  const rev = load().rev
  run('add_fact', { title: 'A' }, 'you', { basedOnRev: rev })
  assert.throws(() => run('add_fact', { title: 'B' }, 'you', { basedOnRev: rev }), (e) => e.code === 'STALE')
  // Reads ignore it.
  run('get_day', {}, 'you', { basedOnRev: 1 })
})

test('import keeps a backup, migrates v1 files and checks the revision', () => {
  const before = load().rev
  const v1 = { profile: { name: 'Old' }, areas: [], goals: [{ id: 'g', title: 'Old goal', status: 'active' }], routines: [], tasks: [{ id: 't', title: 'Old task', date: '2026-01-01' }], days: {}, metrics: [] }
  assert.throws(() => importPlan(v1, before - 1), (e) => e.code === 'STALE')
  importPlan(v1, before)
  const db = load()
  assert.equal(db.schemaVersion, 2)
  assert.equal(db.tasks[0].end, '2026-01-01')
  assert.ok(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('plan-before-import-')))
})

test('a v1 file on disk is backed up once before it is migrated', () => {
  const v1 = { rev: 3, profile: {}, areas: [], goals: [{ id: 'g', title: 'x' }], routines: [], tasks: [], days: {}, metrics: [] }
  writeFileSync(process.env.ARC_DATA, JSON.stringify(v1))
  const db = load()
  assert.equal(db.schemaVersion, 2)
  const bak = join(dir, 'backups', 'plan-before-v2-format.json')
  assert.ok(existsSync(bak))
  assert.equal(JSON.parse(readFileSync(bak, 'utf8')).schemaVersion, undefined)
})

test('every operation is covered by these tests', () => {
  const missing = Object.keys(OPS).filter((k) => !used.has(k))
  assert.deepEqual(missing, [])
})
