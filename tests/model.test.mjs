// The structured item model: linter, criteria evaluation, derived statuses and migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lint, quality, lintPlan, evalItem, evalCriterion, effectiveStatus, blockers, migrate, normCriteria, normRequirements, normProposal, lintRoutine, TEMPLATES, GOAL_TYPES, TASK_TYPES, SCHEMA_VERSION } from '../public/model.js'

const base = () => ({
  profile: { birthDate: '1990-07-01', lifeExpectancy: 85 },
  areas: [{ id: 'money', name: 'Money' }],
  goals: [
    { id: 'life', horizon: 'life', period: 'life', area: 'money', title: 'Debt free', type: 'outcome', status: 'active', noRequirements: true, proposal: { approach: 'Pay it down', steps: [] }, criteria: [{ id: 'c1', kind: 'check', text: 'No debt', evidence: 'Statements' }] },
    { id: 'dec', horizon: 'decade', period: '2020', area: 'money', parentId: 'life', title: 'Emergency fund built', type: 'outcome', status: 'active', why: 'x', noRequirements: true, proposal: { approach: 'File', steps: [] }, criteria: [{ id: 'c1', kind: 'check', text: 'Fund at $10,000', evidence: 'Bank statement' }] },
    { id: 'yr', horizon: 'year', period: '2026', area: 'money', parentId: 'dec', title: 'Professional engaged', type: 'outcome', status: 'active', why: 'x', noRequirements: true, proposal: { approach: 'Call', steps: [] }, criteria: [{ id: 'c1', kind: 'check', text: 'Letter signed', evidence: 'The letter' }] }
  ],
  tasks: [],
  routines: [],
  metrics: [],
  days: {},
  facts: []
})
const completeTask = (over = {}) => ({ id: 't1', title: 'Call the firm', type: 'action', goalId: 'yr', why: 'x', noRequirements: true, proposal: { approach: 'Phone', steps: [] }, criteria: [{ id: 'c1', kind: 'date', text: 'Meeting booked', by: '2026-12-11' }], date: '2026-12-04', end: '2026-12-11', estimate: 30, priority: 'must', status: 'active', ...over })

test('a fully structured goal and task are complete', () => {
  const db = base()
  for (const g of db.goals) assert.deepEqual(lint(db, g, 'goal'), [], g.id)
  db.tasks.push(completeTask())
  assert.deepEqual(lint(db, db.tasks[0], 'task'), [])
  assert.equal(quality([]), 'complete')
})

test('missing sections are flagged as needs work, never silently passed', () => {
  const db = base()
  const t = { id: 't2', title: 'stuff', status: 'active' }
  const issues = lint(db, t, 'task')
  const msgs = issues.map((i) => i.msg).join('|')
  for (const want of ['Choose a type', 'Start a task title with a verb', 'Link it to the goal', 'requirements', 'proposal', 'acceptance criterion', 'end date', 'Estimate', 'priority']) assert.match(msgs, new RegExp(want, 'i'), want)
  assert.equal(quality(issues), 'needs work')
})

test('vague or evidence-free criteria are not checkable', () => {
  const db = base()
  const g = { ...db.goals[2], criteria: [{ id: 'c1', kind: 'check', text: 'Get better at saving' }] }
  const msgs = lint(db, g, 'goal').map((i) => i.msg).join('|')
  assert.match(msgs, /not checkable/)
  assert.match(msgs, /evidence/)
  // A number makes it checkable.
  const g2 = { ...db.goals[2], criteria: [{ id: 'c1', kind: 'check', text: 'Save more than $500', evidence: 'Bank statement' }] }
  assert.deepEqual(lint(db, g2, 'goal'), [])
})

test('structural errors make an item invalid', () => {
  const db = base()
  // Parent on the same horizon.
  assert.match(lint(db, { ...db.goals[2], id: 'y2', parentId: 'yr' }, 'goal').map((i) => i.msg).join(), /longer horizon/)
  // Ends after its own period, and after its parent.
  const late = lint(db, { ...db.goals[2], end: '2027-01-15' }, 'goal')
  assert.equal(quality(late), 'invalid')
  assert.match(late.map((i) => i.msg).join(), /after its own period/)
  // A task ending after the goal it serves.
  assert.match(lint(db, completeTask({ end: '2027-02-01' }), 'task').map((i) => i.msg).join(), /after the goal it serves/)
  // Starts after it ends.
  assert.match(lint(db, completeTask({ start: '2026-12-20' }), 'task').map((i) => i.msg).join(), /starts after it ends/)
  // Metric criterion pointing nowhere.
  assert.match(lint(db, completeTask({ criteria: [{ id: 'c1', kind: 'metric', text: 'x', metricId: 'nope', op: '<=', value: 1 }] }), 'task').map((i) => i.msg).join(), /metric that does not exist/)
  // Skipping a horizon is a warning, not an error.
  const skip = lint(db, { ...db.goals[2], parentId: 'life' }, 'goal')
  assert.equal(quality(skip), 'needs work')
})

test('requirement loops are caught', () => {
  const db = base()
  db.tasks.push(completeTask({ id: 'a', requirements: [{ kind: 'item', itemId: 't:b', text: 'b', blocking: true }], noRequirements: false }))
  db.tasks.push(completeTask({ id: 'b', requirements: [{ kind: 'item', itemId: 't:a', text: 'a', blocking: true }], noRequirements: false }))
  assert.match(lint(db, db.tasks[0], 'task').map((i) => i.msg).join(), /loop/)
})

test('criteria are evaluated from data', () => {
  const db = base()
  db.metrics.push({ id: 'bw', name: 'Bodyweight', unit: 'lb', entries: [{ date: '2026-08-01', value: 230 }, { date: '2026-10-01', value: 210 }] })
  const c = { kind: 'metric', metricId: 'bw', op: '<=', value: 190 }
  const r = evalCriterion(db, c, {}, 'goal', '2026-11-21')
  assert.equal(r.met, false)
  assert.equal(r.value, 210)
  assert.equal(Math.round(r.progress * 100), 50)
  assert.equal(evalCriterion(db, { ...c, value: 215 }, {}, 'goal', '2026-11-21').met, true)
  // Readings after the date are ignored.
  assert.equal(evalCriterion(db, c, {}, 'goal', '2026-09-01').value, 230)
  // Count of children done.
  db.tasks.push(completeTask({ status: 'done' }), completeTask({ id: 't2' }))
  const count = evalCriterion(db, { kind: 'count', of: 'tasks', value: 2 }, db.goals[2], 'goal')
  assert.deepEqual([count.met, count.value], [false, 1])
  // Adherence over a window.
  db.routines.push({ id: 'r1', title: 'Study', days: [0, 1, 2, 3, 4, 5, 6], start: '2026-01-01' })
  for (const d of ['2026-11-18', '2026-11-19', '2026-11-20']) db.days[d] = { checks: { 'r:r1': { status: 'done' } } }
  db.days['2026-11-21'] = { checks: { 'r:r1': { status: 'partial' } } }
  const adh = evalCriterion(db, { kind: 'adherence', routineId: 'r1', pct: 80, windowDays: 4 }, {}, 'goal', '2026-11-21')
  assert.equal(adh.value, 88)
  assert.equal(adh.met, true)
  // Item progress averages criteria.
  const g = { ...db.goals[2], criteria: [{ kind: 'check', met: true }, { kind: 'check', met: false }] }
  assert.equal(evalItem(db, g, 'goal').progress, 50)
  assert.equal(evalItem(db, g, 'goal').allMet, false)
})

test('missed and blocked are derived, closed items stay closed', () => {
  const db = base()
  const t = completeTask({ end: '2026-11-01', date: '2026-11-01' })
  assert.equal(effectiveStatus(db, t, 'task', '2026-11-21'), 'missed')
  assert.equal(effectiveStatus(db, { ...t, status: 'done' }, 'task', '2026-11-21'), 'done')
  db.tasks.push(completeTask({ id: 'pre' }))
  const blocked = completeTask({ id: 'x', requirements: [{ kind: 'item', itemId: 't:pre', text: 'pre', blocking: true }] })
  assert.equal(effectiveStatus(db, blocked, 'task', '2026-11-21'), 'blocked')
  assert.deepEqual(blockers(db, blocked), ['pre'])
  db.tasks[0].status = 'done'
  assert.equal(effectiveStatus(db, blocked, 'task', '2026-11-21'), 'active')
  // A non-item requirement only blocks when marked blocking and unmet.
  assert.equal(effectiveStatus(db, completeTask({ requirements: [{ kind: 'money', text: '$500', blocking: false }] }), 'task', '2026-11-21'), 'active')
  assert.equal(effectiveStatus(db, completeTask({ requirements: [{ kind: 'money', text: '$500', blocking: true, met: false }] }), 'task', '2026-11-21'), 'blocked')
})

test('input is normalised', () => {
  assert.deepEqual(normCriteria(['Letter signed']), [{ id: 'c1', kind: 'check', text: 'Letter signed', evidence: '', met: false }])
  assert.equal(normCriteria([{ kind: 'metric', metricId: 'bw', op: 'bogus', value: '190' }])[0].op, '>=')
  assert.equal(normCriteria([{ kind: 'metric', metricId: 'bw', op: '<=', value: '190' }])[0].value, 190)
  assert.deepEqual(normRequirements(['Transcripts']), [{ kind: 'info', text: 'Transcripts', met: false, blocking: false }])
  assert.equal(normRequirements([{ kind: 'item', itemId: 'g:x', text: 'x' }])[0].blocking, true)
  assert.deepEqual(normProposal('Call them'), { approach: 'Call them', steps: [] })
  assert.throws(() => normCriteria('nope'))
})

test('v1 plans migrate to the structured format', () => {
  const db = { goals: [{ id: 'g', title: 'A', status: 'active', detail: 'You said (Oct 2026): yes' }, { id: 'h', title: 'B', detail: 'Proposed.' }], tasks: [{ id: 't', title: 'Do', date: '2026-11-20' }, { id: 'u', title: 'Done', date: '2026-11-19' }], days: { '2026-11-19': { checks: { 't:u': { status: 'done' } } } } }
  assert.equal(migrate(db), true)
  assert.equal(db.schemaVersion, SCHEMA_VERSION)
  assert.equal(db.goals[0].origin, 'mined')
  assert.equal(db.goals[1].origin, 'claude')
  assert.equal(db.goals[1].status, 'active')
  assert.deepEqual(db.goals[0].criteria, [])
  assert.equal(db.tasks[0].end, '2026-11-20')
  assert.equal(db.tasks[1].status, 'done')
  assert.deepEqual(db.policy.excluded, [])
  assert.equal(migrate(db), false)
})

test('templates exist for every type and pass the linter once linked', () => {
  const db = base()
  db.metrics.push({ id: 'bw', name: 'Bodyweight', unit: 'lb', entries: [] })
  db.routines.push({ id: 'r1', title: 'Lift' })
  for (const [kind, types] of [['goal', GOAL_TYPES], ['task', TASK_TYPES]]) {
    for (const t of Object.keys(types)) {
      const tpl = TEMPLATES[kind][t]
      assert.ok(tpl, `${kind} ${t}`)
      const crit = normCriteria(tpl.criteria).map((c) => ({ ...c, metricId: c.metricId === '' ? 'bw' : c.metricId, routineId: c.routineId === '' ? 'r1' : c.routineId, by: c.by === '' ? '2026-12-01' : c.by }))
      const item = kind === 'goal' ? { id: 'n', horizon: 'month', period: '2026-12', parentId: 'yr', why: tpl.why || 'x', title: tpl.title, type: t, requirements: normRequirements(tpl.requirements), noRequirements: !tpl.requirements.length, proposal: normProposal(tpl.proposal), criteria: crit } : { ...completeTask(), title: tpl.title, type: t, why: tpl.why || 'x', requirements: normRequirements(tpl.requirements), noRequirements: !tpl.requirements.length, proposal: normProposal(tpl.proposal), criteria: crit }
      const errors = lint(db, item, kind).filter((i) => i.level === 'error')
      assert.deepEqual(errors, [], `${kind} ${t}`)
    }
  }
})

test('routines need a pass criterion and a habit goal', () => {
  const db = base()
  db.goals.push({ id: 'hab', type: 'habit', horizon: 'month', period: '2026-12', title: 'Study' })
  assert.equal(lintRoutine(db, { goalId: 'hab', criterion: 'One section at 80%' }).length, 0)
  assert.equal(lintRoutine(db, { goalId: 'yr', criterion: 'x' }).length, 1)
  assert.equal(lintRoutine(db, {}).length, 2)
})

test('the whole-plan report counts and ranks problems', () => {
  const db = base()
  db.tasks.push(completeTask(), { id: 'bad', title: 'x' })
  const r = lintPlan(db)
  assert.equal(r.total, 5)
  assert.equal(r.complete, 4)
  assert.equal(r.needsWork, 1)
  assert.ok(r.commonProblems.length > 3)
})
