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

test('proposals: Claude proposes, only the user accepts or rejects', () => {
  const t = run('upsert_task', { title: 'Rough idea', goalId: yearId, date: D }, 'you')
  const p = run('propose_changes', { batch: 'restructure', changes: [{ ref: 't:' + t.id, action: 'update', reason: 'Structure it', fields: { type: 'action', title: 'Write the rough idea down', why: 'x', noRequirements: true, proposal: { approach: 'One page' }, criteria: [{ kind: 'check', text: 'One page written', evidence: 'The page' }], end: D, estimate: 20, priority: 'could', goalId: 'g:' + yearId } }] }, 'claude')
  assert.equal(p.pending, 1)
  // Nothing changes before review.
  assert.equal(load().tasks.find((x) => x.id === t.id).title, 'Rough idea')
  const listed = run('list_proposals', {})
  assert.equal(listed.counts.changes, 1)
  assert.equal(listed.changes[0].before.title, 'Rough idea')
  // A new proposal for the same item replaces the old one.
  run('propose_changes', { changes: [{ ref: 't:' + t.id, action: 'drop', reason: 'Duplicate' }] }, 'claude')
  assert.equal(run('list_proposals', {}).changes[0].action, 'drop')
  run('withdraw_proposals', { refs: ['t:' + t.id] }, 'claude')
  assert.equal(load().proposals.length, 0)
  run('propose_changes', { batch: 'restructure', changes: [{ ref: 't:' + t.id, action: 'update', reason: 'Structure it', fields: { type: 'action', title: 'Write the rough idea down', why: 'x', noRequirements: true, proposal: { approach: 'One page' }, criteria: [{ kind: 'check', text: 'One page written', evidence: 'The page' }], end: D, estimate: 20, priority: 'could' } }] }, 'claude')
  assert.throws(() => run('propose_changes', { changes: [{ ref: 't:' + t.id, action: 'update', reason: 'x', fields: { status: 'done' } }] }, 'claude'), /cannot be proposed/)
  assert.throws(() => run('propose_changes', { changes: [{ ref: 't:' + t.id, action: 'update', reason: 'x', fields: { goalId: 'nope' } }] }, 'claude'), /does not exist/)
  assert.throws(() => run('propose_changes', { changes: [{ ref: 't:' + t.id, action: 'update', fields: { title: 'x' } }] }, 'claude'), /reason/)
  const pid = load().proposals[0].id
  assert.throws(() => run('review_proposals', { ids: [pid], decision: 'accept' }, 'claude'), /dashboard/)
  const r = run('review_proposals', { ids: [pid], decision: 'accept' })
  assert.equal(r.done, 1)
  const after = run('get_item', { ref: 't:' + t.id })
  assert.equal(after.title, 'Write the rough idea down')
  assert.equal(after.quality, 'complete')
  // New items Claude created incomplete wait as proposals; rejecting deletes them, accepting activates them.
  const a = run('upsert_task', { title: 'Claude idea one', date: D }, 'claude')
  const b = run('upsert_task', { title: 'Claude idea two', date: D }, 'claude')
  assert.equal(run('get_day', { date: D }).items.find((i) => i.title === 'Claude idea one').proposed, true)
  run('review_proposals', { refs: ['t:' + a.id], decision: 'reject' })
  run('review_proposals', { refs: ['t:' + b.id], decision: 'accept' })
  assert.equal(load().tasks.some((x) => x.id === a.id), false)
  assert.equal(load().tasks.find((x) => x.id === b.id).status, 'active')
  // A drop proposal closes the item as dropped, with the reason as its outcome.
  run('propose_changes', { changes: [{ ref: 't:' + b.id, action: 'drop', reason: 'Not needed' }] }, 'claude')
  run('review_proposals', { ids: [load().proposals[0].id], decision: 'accept' })
  const dropped = load().tasks.find((x) => x.id === b.id)
  assert.equal(dropped.status, 'dropped')
  assert.match(dropped.outcome.text, /Not needed/)
})

test('proposed items show on the day but do not count toward its score', () => {
  const day = addDays(D, 3)
  run('upsert_task', { title: 'Accepted thing', date: day, goalId: yearId })
  run('upsert_task', { title: 'Proposed thing', date: day }, 'claude')
  const p = run('get_day', { date: day })
  assert.equal(p.items.length, 2)
  assert.equal(p.score.total, 1)
})

test('triage: missed items are listed and decided', () => {
  const past = addDays(D, -5)
  const t1 = run('upsert_task', { title: 'Overdue call', date: past, goalId: yearId })
  const t2 = run('upsert_task', { title: 'Overdue habit', date: past, goalId: yearId, criteria: [{ kind: 'check', text: 'Ten minutes done', evidence: 'Log' }] })
  const t3 = run('upsert_task', { title: 'Overdue chore', date: past, goalId: yearId })
  const t4 = run('upsert_task', { title: 'Overdue thing done late', date: past, goalId: yearId, criteria: [{ kind: 'check', text: 'Form sent', evidence: 'Receipt' }] })
  const o = run('list_overdue', {})
  for (const t of [t1, t2, t3, t4]) assert.ok(o.missed.some((m) => m.ref === 't:' + t.id))
  const moved = run('triage', { ref: 't:' + t1.id, action: 'move', date: D })
  assert.equal(moved.effectiveStatus, 'active')
  assert.equal(moved.date, D)
  const before = load().routines.length
  run('triage', { ref: 't:' + t2.id, action: 'routine', days: [1, 3, 5] })
  assert.equal(load().routines.length, before + 1)
  assert.equal(load().routines.at(-1).criterion, 'Ten minutes done')
  assert.equal(load().tasks.find((x) => x.id === t2.id).status, 'dropped')
  run('triage', { ref: 't:' + t3.id, action: 'drop', reason: 'No longer relevant' })
  assert.throws(() => run('triage', { ref: 't:' + t4.id, action: 'done' }), (e) => e.code === 'CRITERIA')
  run('triage', { ref: 't:' + t4.id, action: 'done', overrideReason: 'Sent by post' })
  assert.equal(run('list_overdue', {}).missed.filter((m) => [t1, t2, t3, t4].some((t) => m.ref === 't:' + t.id)).length, 0)
  assert.throws(() => run('triage', { ref: 'g:' + yearId, action: 'move', date: '2099-01-01' }), /cannot end after its period/)
  assert.throws(() => run('triage', { ref: 'g:' + yearId, action: 'routine' }), /Only a task/)
  const ov = run('get_overview', {})
  assert.ok('inbox' in ov && 'overdue' in ov)
})

test('focus: suggested until chosen, at most three, Claude can set it', () => {
  const day = addDays(D, 20)
  const must = run('upsert_task', { title: 'Must thing', date: day, goalId: yearId, priority: 'must', estimate: 30 })
  const could = run('upsert_task', { title: 'Could thing', date: day, goalId: yearId, priority: 'could', estimate: 30 })
  const g = run('get_day', { date: day })
  assert.equal(g.focus.chosen, false)
  assert.equal(g.focus.keys[0], 't:' + must.id)
  run('set_focus', { date: day, keys: ['Could thing'] }, 'claude')
  const after = run('get_day', { date: day })
  assert.deepEqual(after.focus, { keys: ['t:' + could.id], chosen: true, by: 'claude' })
  assert.throws(() => run('set_focus', { date: day, keys: ['t:nope'] }), /not on/)
  run('set_focus', { date: day, keys: [] })
  assert.equal(run('get_day', { date: day }).focus.chosen, false)
})

test('capacity: Claude cannot overfill a day; balancing moves could and should tasks', () => {
  run('set_capacity', { minutes: [60, 60, 60, 60, 60, 60, 60] })
  assert.throws(() => run('set_capacity', { minutes: [60] }), /seven/)
  assert.throws(() => run('set_capacity', { minutes: [60, 60, 60, 60, 60, 60, 60] }, 'claude'), /dashboard/)
  const day = addDays(D, 10)
  run('upsert_task', { type: 'action', title: 'Call the bank', goalId: yearId, why: 'x', noRequirements: true, proposal: { approach: 'Phone' }, criteria: [{ kind: 'check', text: 'Called the bank', evidence: 'Call log' }], date: day, end: addDays(day, 5), estimate: 45, priority: 'must' }, 'claude')
  // The second task does not fit: refused, naming the next day with room.
  assert.throws(
    () => run('upsert_task', { type: 'action', title: 'Call the gym', goalId: yearId, why: 'x', noRequirements: true, proposal: { approach: 'Phone' }, criteria: [{ kind: 'check', text: 'Called the gym', evidence: 'Call log' }], date: day, end: addDays(day, 5), estimate: 30, priority: 'could' }, 'claude'),
    (e) => e.code === 'CAPACITY' && e.nextFreeDay === addDays(day, 1)
  )
  // The user is never refused, and balancing moves the could task, not the must one.
  const extra = run('upsert_task', { title: 'Call the gym', goalId: yearId, date: day, end: addDays(day, 5), estimate: 30, priority: 'could' })
  const plan = run('balance_days', { from: day, to: day })
  assert.deepEqual(plan.moves.map((m) => [m.ref, m.to]), [['t:' + extra.id, addDays(day, 1)]])
  assert.equal(load().tasks.find((t) => t.id === extra.id).date, day)
  assert.throws(() => run('apply_balance', { from: day, to: day }, 'claude'), /dashboard/)
  run('apply_balance', { from: day, to: day })
  assert.equal(load().tasks.find((t) => t.id === extra.id).date, addDays(day, 1))
  assert.equal(run('get_day', { date: day }).load.over, false)
  run('set_capacity', { minutes: [600, 600, 600, 600, 600, 600, 600] })
})

test('decisions: options, a choice, the history and closing', () => {
  const t = run('upsert_task', { type: 'decision', title: 'Decide which course first', goalId: yearId, date: D, end: addDays(D, 3), decision: { question: 'Which course first?', options: ['Course A', { text: 'Course B', notes: 'cheaper' }], reviewBy: addDays(D, 2) } })
  assert.equal(t.decision.options.length, 2)
  assert.equal(run('get_item', { ref: 't:' + t.id }).criteria[0].kind, 'decision')
  assert.ok(run('get_overview', {}).decisionsDue.some((x) => x.ref === 't:' + t.id))
  const before = load().facts.length
  const r = run('decide', { ref: 't:' + t.id, option: 'Course B', reasons: 'Cost' }, 'claude')
  assert.equal(r.decision.chosen, 1)
  assert.equal(r.closedNow, true)
  assert.equal(r.status, 'done')
  assert.equal(load().facts.length, before + 1)
  assert.match(load().facts.at(-1).detail, /Course B/)
  assert.throws(() => run('decide', { ref: 't:' + t.id, option: 7 }), /not on the list/)
})

test('routines can be proposed, accepted and dropped; zero-minute estimates count as zero', () => {
  const r = run('upsert_routine', { title: 'Protein', area: 'health', target: '120 g', days: [0, 1, 2, 3, 4, 5, 6] })
  run('propose_changes', { changes: [{ ref: 'r:' + r.id, action: 'update', reason: 'Takes no planned time', fields: { estimate: 0, days: [1, 3, 5] } }] }, 'claude')
  assert.throws(() => run('propose_changes', { changes: [{ ref: 'r:' + r.id, action: 'update', reason: 'x', fields: { priority: 'must' } }] }, 'claude'), /cannot be proposed for a routine/)
  assert.throws(() => run('propose_changes', { changes: [{ ref: 'r:' + r.id, action: 'update', reason: 'x', fields: { days: [9] } }] }, 'claude'), /0 to 6/)
  const p = load().proposals.find((x) => x.ref === 'r:' + r.id)
  assert.equal(p.kind, 'routine')
  assert.equal(run('list_proposals', {}).changes.find((x) => x.id === p.id).before.days.length, 7)
  run('review_proposals', { ids: [p.id], decision: 'accept' })
  const after = load().routines.find((x) => x.id === r.id)
  assert.deepEqual([after.estimate, after.days], [0, [1, 3, 5]])
  run('propose_changes', { changes: [{ ref: 'r:' + r.id, action: 'drop', reason: 'Not needed' }] }, 'claude')
  run('review_proposals', { ids: [load().proposals.find((x) => x.ref === 'r:' + r.id).id], decision: 'accept' })
  assert.equal(load().routines.find((x) => x.id === r.id).active, false)
  run('upsert_metric', { id: load().metrics[0].id, cadence: 'weekly' })
  assert.equal(load().metrics[0].cadence, 'weekly')
})

test('moving a task between days, and reordering a day', () => {
  const day = addDays(D, 6)
  const t = run('upsert_task', { title: 'Move me', goalId: yearId, date: day, end: day, estimate: 10 })
  const u = run('upsert_task', { title: 'Stay here', goalId: yearId, date: day, estimate: 10 })
  run('set_focus', { date: day, keys: ['t:' + t.id] })
  const r = run('move_task', { ref: 't:' + t.id, date: addDays(day, 2) })
  assert.deepEqual([r.from, r.date, r.end], [day, addDays(day, 2), addDays(day, 2)])
  assert.equal(run('get_day', { date: day }).focus.chosen, false)
  // Moving earlier keeps the later end date.
  run('move_task', { ref: t.id, date: addDays(day, 1) })
  assert.equal(load().tasks.find((x) => x.id === t.id).end, addDays(day, 2))
  // Never past the end of the goal it serves.
  assert.throws(() => run('move_task', { ref: 't:' + t.id, date: '2099-01-01' }), (e) => e.code === 'WINDOW')
  run('close_item', { ref: 't:' + u.id, status: 'done', overrideReason: 'test' })
  assert.throws(() => run('move_task', { ref: 't:' + u.id, date: day }), /reopen/)
  run('close_item', { ref: 't:' + u.id, status: 'active' })
  // Reordering keeps only keys on that day, and the day plan follows it.
  run('move_task', { ref: 't:' + t.id, date: day })
  run('reorder_day', { date: day, keys: ['t:' + u.id, 't:nope', 't:' + t.id] })
  const order = run('get_day', { date: day }).items.filter((i) => i.kind === 'task').map((i) => i.title)
  assert.deepEqual(order.slice(0, 2), ['Stay here', 'Move me'])
  assert.deepEqual(load().days[day].order, ['t:' + u.id, 't:' + t.id])
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
