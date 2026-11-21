// The structured item model (PRD section S): types, statuses, requirements, proposals, acceptance criteria, the
// plan linter, criteria evaluation and the v1 -> v2 migration. Shared by the server and the dashboard.
import { addDays, parse, weekStart, daysInMonth, dayPlan, today, HORIZONS } from './shared.js'

export const SCHEMA_VERSION = 2

export const GOAL_TYPES = {
  outcome: { label: 'Outcome', hint: 'A state of the world to reach' },
  metric: { label: 'Metric target', hint: 'A number to reach by a date' },
  habit: { label: 'Habit', hint: 'A behaviour held over a period' },
  milestone: { label: 'Milestone', hint: 'A one-time event or release' },
  decision: { label: 'Decision', hint: 'A choice to settle' }
}
export const TASK_TYPES = {
  action: { label: 'Action', hint: 'A single thing to do' },
  deliverable: { label: 'Deliverable', hint: 'A thing to produce' },
  research: { label: 'Research', hint: 'Questions to answer' },
  appointment: { label: 'Appointment', hint: 'Something at a fixed time and place' },
  admin: { label: 'Admin', hint: 'Paperwork, accounts, errands' },
  practice: { label: 'Practice', hint: 'One instance of a routine' }
}
/** Stored statuses. "blocked" and "missed" are derived (see effectiveStatus). */
export const ITEM_STATUSES = ['proposed', 'accepted', 'active', 'done', 'dropped']
export const STATUS_LABELS = { proposed: 'Proposed', accepted: 'Accepted', active: 'Active', blocked: 'Blocked', done: 'Done', missed: 'Missed', dropped: 'Dropped' }
export const CLOSED = new Set(['done', 'dropped'])
export const PRIORITIES = ['must', 'should', 'could']
export const REQ_KINDS = { item: 'Another item', money: 'Money', time: 'Time', resource: 'Resource or tool', info: 'Information', person: 'A person' }
export const CRIT_KINDS = { check: 'Yes or no, with evidence', metric: 'Metric threshold', count: 'Count of items done', adherence: 'Routine adherence', date: 'Happened by a date' }
export const OPS_CMP = ['<=', '>=', '<', '>', '=']
export const ORIGINS = ['you', 'claude', 'mined']
// Types whose proposal (approach) may be left empty: the type itself says how.
const PROPOSAL_OPTIONAL = new Set(['appointment', 'admin', 'practice'])

// ---- periods and dates ---------------------------------------------------------------------------------------------
export function periodEnd(db, horizon, period) {
  if (horizon === 'life') {
    const b = db.profile?.birthDate
    return b ? `${+b.slice(0, 4) + (db.profile.lifeExpectancy || 85)}-12-31` : '2100-12-31'
  }
  if (horizon === 'decade') return `${+period + 9}-12-31`
  if (horizon === 'year') return `${period}-12-31`
  if (horizon === 'month') {
    const [y, m] = period.split('-').map(Number)
    return `${period}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  }
  if (horizon === 'week') {
    const [y, w] = period.split('-W').map(Number)
    return addDays(weekStart(`${y}-01-04`), (w - 1) * 7 + 6)
  }
  return null
}
export function periodStart(db, horizon, period) {
  if (horizon === 'life') return db.profile?.birthDate || null
  if (horizon === 'decade') return `${period}-01-01`
  if (horizon === 'year') return `${period}-01-01`
  if (horizon === 'month') return `${period}-01`
  if (horizon === 'week') {
    const [y, w] = period.split('-W').map(Number)
    return addDays(weekStart(`${y}-01-04`), (w - 1) * 7)
  }
  return null
}
/** The date an item must be done by: its own end, else (goals) the end of its period. */
export function itemEnd(db, item, kind) {
  if (item.end) return item.end
  if (kind !== 'goal') return item.date || null
  // A period that runs past the end of the life arc ends with it.
  const pe = periodEnd(db, item.horizon, item.period)
  const life = periodEnd(db, 'life', 'life')
  return pe && life && pe > life ? life : pe
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime())

// ---- lookups -------------------------------------------------------------------------------------------------------
export function findItem(db, ref) {
  if (!ref) return null
  const [k, id] = ref.includes(':') ? ref.split(':') : [null, ref]
  if (k === 'g' || !k) {
    const g = db.goals.find((x) => x.id === id)
    if (g) return { kind: 'goal', item: g, ref: 'g:' + g.id }
  }
  if (k === 't' || !k) {
    const t = db.tasks.find((x) => x.id === id)
    if (t) return { kind: 'task', item: t, ref: 't:' + t.id }
  }
  return null
}
export const parentOf = (db, item, kind) => db.goals.find((g) => g.id === (kind === 'goal' ? item.parentId : item.goalId)) || null
export function ancestors(db, item, kind) {
  const out = []
  let p = parentOf(db, item, kind)
  const seen = new Set()
  while (p && !seen.has(p.id)) {
    seen.add(p.id)
    out.unshift(p)
    p = parentOf(db, p, 'goal')
  }
  return out
}
export const childGoals = (db, g) => db.goals.filter((x) => x.parentId === g.id)
export const childTasks = (db, g) => db.tasks.filter((x) => x.goalId === g.id)
export const childRoutines = (db, g) => db.routines.filter((x) => x.goalId === g.id)

// ---- normalising input ---------------------------------------------------------------------------------------------
const str = (v) => (v == null ? '' : String(v).trim())
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v)
function bad(msg) {
  const e = new Error(msg)
  e.code = 'INVALID'
  return e
}
export function normRequirements(list) {
  if (list == null) return undefined
  if (!Array.isArray(list)) throw bad('requirements must be a list')
  return list
    .map((r) => (typeof r === 'string' ? { kind: 'info', text: r } : r))
    .filter((r) => r && (str(r.text) || r.itemId))
    .map((r) => {
      const kind = REQ_KINDS[r.kind] ? r.kind : 'info'
      const out = { kind, text: str(r.text), met: !!r.met }
      if (kind === 'item') out.itemId = str(r.itemId)
      if (kind === 'money' || kind === 'time') out.amount = numOrNull(r.amount)
      out.blocking = r.blocking == null ? kind === 'item' : !!r.blocking
      return out
    })
}
export function normProposal(p) {
  if (p == null) return undefined
  if (typeof p === 'string') return { approach: str(p), steps: [] }
  if (typeof p !== 'object') throw bad('proposal must be an object with approach and steps')
  const steps = (Array.isArray(p.steps) ? p.steps : [])
    .map((s) => (typeof s === 'string' ? { text: s } : s))
    .filter((s) => s && str(s.text))
    .map((s) => ({ text: str(s.text), done: !!s.done }))
  return { approach: str(p.approach), steps }
}
export function normCriteria(list) {
  if (list == null) return undefined
  if (!Array.isArray(list)) throw bad('criteria must be a list')
  let n = 0
  return list
    .map((c) => (typeof c === 'string' ? { kind: 'check', text: c } : c))
    .filter(Boolean)
    .map((c) => {
      const kind = CRIT_KINDS[c.kind] ? c.kind : 'check'
      const out = { id: str(c.id) || `c${++n}`, kind, text: str(c.text) }
      if (kind === 'check') Object.assign(out, { evidence: str(c.evidence), met: !!c.met })
      if (kind === 'metric') Object.assign(out, { metricId: str(c.metricId), op: OPS_CMP.includes(c.op) ? c.op : '>=', value: numOrNull(c.value) })
      if (kind === 'count') Object.assign(out, { of: ['children', 'tasks', 'instances'].includes(c.of) ? c.of : 'children', value: numOrNull(c.value) })
      if (kind === 'adherence') Object.assign(out, { routineId: str(c.routineId), pct: numOrNull(c.pct), windowDays: numOrNull(c.windowDays) || 28 })
      if (kind === 'date') Object.assign(out, { by: str(c.by), met: !!c.met, on: str(c.on) || undefined })
      return out
    })
}

// ---- criteria evaluation -------------------------------------------------------------------------------------------
const cmp = (a, op, b) => (op === '<=' ? a <= b : op === '>=' ? a >= b : op === '<' ? a < b : op === '>' ? a > b : a === b)
const clamp = (x) => Math.max(0, Math.min(1, x))

/** Evaluates one criterion. Returns { met, value, progress (0..1), label }. */
export function evalCriterion(db, c, item, kind, date = today()) {
  if (c.kind === 'check') return { met: !!c.met, progress: c.met ? 1 : 0, label: c.met ? 'Met' : 'Not yet' }
  if (c.kind === 'date') {
    const met = !!c.met && (!c.on || !c.by || c.on <= c.by)
    return { met, progress: met ? 1 : 0, label: met ? `Done ${c.on || ''}`.trim() : c.by ? `By ${c.by}` : 'Not yet' }
  }
  if (c.kind === 'metric') {
    const m = db.metrics.find((x) => x.id === c.metricId)
    if (!m || c.value == null) return { met: false, progress: 0, label: 'Metric missing' }
    const e = (m.entries || []).filter((x) => x.date <= date).sort((a, b) => a.date.localeCompare(b.date))
    if (!e.length) return { met: false, progress: 0, value: null, label: 'No readings yet' }
    const v = e.at(-1).value
    const f = e[0].value
    const met = cmp(v, c.op, c.value)
    let progress = met ? 1 : 0
    if (!met && f !== c.value) progress = clamp(c.op.startsWith('<') ? (f - v) / (f - c.value) : (v - f) / (c.value - f))
    return { met, value: v, progress, label: `${v}${m.unit ? ' ' + m.unit : ''} now, ${c.op} ${c.value} needed` }
  }
  if (c.kind === 'count') {
    if (!c.value) return { met: false, progress: 0, label: 'No count set' }
    let n = 0
    if (kind === 'goal') {
      if (c.of === 'children') n = childGoals(db, item).filter((g) => g.status === 'done').length + childTasks(db, item).filter((t) => t.status === 'done').length
      if (c.of === 'tasks') n = childTasks(db, item).filter((t) => t.status === 'done').length
      if (c.of === 'instances') {
        const keys = new Set(childRoutines(db, item).map((r) => 'r:' + r.id))
        for (const [d, day] of Object.entries(db.days || {})) {
          if (d > date) continue
          for (const [k, ch] of Object.entries(day.checks || {})) if (keys.has(k) && ch.status === 'done') n++
        }
      }
    }
    return { met: n >= c.value, value: n, progress: clamp(n / c.value), label: `${n} of ${c.value}` }
  }
  if (c.kind === 'adherence') {
    const r = db.routines.find((x) => x.id === c.routineId)
    if (!r || !c.pct) return { met: false, progress: 0, label: 'Routine missing' }
    let sched = 0
    let got = 0
    for (let i = 0; i < c.windowDays; i++) {
      const d = addDays(date, -i)
      const it = dayPlan(db, d).items.find((x) => x.key === 'r:' + r.id)
      if (!it) continue
      sched++
      got += it.status === 'done' ? 1 : it.status === 'partial' ? 0.5 : 0
    }
    const pct = sched ? Math.round((got / sched) * 100) : 0
    return { met: sched > 0 && pct >= c.pct, value: pct, progress: clamp(pct / c.pct), label: `${pct}% over ${c.windowDays} days, ${c.pct}% needed` }
  }
  return { met: false, progress: 0, label: '' }
}

/** All criteria evaluated, plus whether all are met and overall progress (0..100). */
export function evalItem(db, item, kind, date = today()) {
  const crit = (item.criteria || []).map((c) => ({ ...c, eval: evalCriterion(db, c, item, kind, date) }))
  const allMet = crit.length > 0 && crit.every((c) => c.eval.met)
  const progress = crit.length ? Math.round((crit.reduce((s, c) => s + c.eval.progress, 0) / crit.length) * 100) : item.progress || 0
  return { criteria: crit, allMet, progress, computed: crit.length > 0 }
}

export function blockers(db, item) {
  const out = []
  for (const r of item.requirements || []) {
    if (r.kind === 'item') {
      const f = findItem(db, r.itemId)
      if (!f || f.item.status !== 'done') out.push(r.text || (f ? f.item.title : 'Another item'))
    } else if (r.blocking && !r.met) out.push(r.text)
  }
  return out
}

/** Status as shown: stored status, or derived "missed" (end passed, not closed) or "blocked". */
export function effectiveStatus(db, item, kind, date = today()) {
  const s = item.status || 'active'
  if (CLOSED.has(s)) return s
  const end = itemEnd(db, item, kind)
  if (end && end < date) return 'missed'
  if (blockers(db, item).length) return 'blocked'
  return s
}

// ---- linter --------------------------------------------------------------------------------------------------------
const VAGUE = /\b(better|more|less|improve\w*|work on|try|some|good|nice|well|enough|stuff|things|progress|focus on|consider)\b/i
// Common imperative verbs. A task title should start with one (a warning only).
const VERBS = new Set(
  'add apply ask attend audit back book build buy call cancel change check choose clean clear close collect compare complete confirm contact count create cut decide define delete deliver design dispute do document download draft drop email enrol enroll estimate evaluate export file fill find finish fix follow get give go hire install interview invite join learn list log look make map measure meet message migrate move negotiate open order organise organize outline pack pass pay pick plan play post practise practice prepare present price print publish pull put read rebuild record refactor register release remove renew repair replace reply request research reschedule resume retake return review rewrite run save schedule search see sell send set settle ship shoot shortlist sign sketch sort start study submit switch take talk teach test text track train transfer try tune update upload use verify visit wash watch weigh write'.split(
    ' '
  )
)
export function criterionProblems(db, c) {
  const p = []
  if (c.kind === 'check') {
    if (!c.text) p.push({ level: 'warn', msg: 'A yes-or-no criterion needs a statement' })
    else if (VAGUE.test(c.text) && !/\d/.test(c.text)) p.push({ level: 'warn', msg: `"${c.text}" is not checkable: add a number, a yes-or-no test or a named artefact` })
    if (!c.evidence) p.push({ level: 'warn', msg: `Say what evidence proves "${c.text || 'this criterion'}"` })
  }
  if (c.kind === 'metric') {
    if (!db.metrics.some((m) => m.id === c.metricId)) p.push({ level: 'error', msg: 'A metric criterion points at a metric that does not exist' })
    if (c.value == null) p.push({ level: 'error', msg: 'A metric criterion needs a threshold' })
  }
  if (c.kind === 'count' && !(c.value > 0)) p.push({ level: 'error', msg: 'A count criterion needs a number above zero' })
  if (c.kind === 'adherence') {
    if (!db.routines.some((r) => r.id === c.routineId)) p.push({ level: 'error', msg: 'An adherence criterion points at a routine that does not exist' })
    if (!(c.pct > 0 && c.pct <= 100)) p.push({ level: 'error', msg: 'An adherence criterion needs a percentage from 1 to 100' })
  }
  if (c.kind === 'date' && !isDate(c.by)) p.push({ level: 'error', msg: 'A date criterion needs a "by" date' })
  return p
}

function hasCycle(db, startRef) {
  const seen = new Set()
  const walk = (ref, path) => {
    if (path.has(ref)) return true
    if (seen.has(ref)) return false
    seen.add(ref)
    const f = findItem(db, ref)
    if (!f) return false
    const next = new Set(path).add(ref)
    return (f.item.requirements || []).some((r) => r.kind === 'item' && r.itemId && walk(findItem(db, r.itemId)?.ref || r.itemId, next))
  }
  return walk(startRef, new Set())
}

/** Lints one goal or task. Returns a list of { level: 'error' | 'warn', msg }. */
export function lint(db, item, kind) {
  const out = []
  const warn = (msg) => out.push({ level: 'warn', msg })
  const err = (msg) => out.push({ level: 'error', msg })
  const types = kind === 'goal' ? GOAL_TYPES : TASK_TYPES
  if (!str(item.title)) err('No title')
  if (!item.type) warn(`Choose a type (${Object.values(types).map((t) => t.label).join(', ')})`)
  else if (!types[item.type]) err(`Unknown type "${item.type}"`)
  if (kind === 'task' && item.title) {
    const first = item.title.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')
    if (!VERBS.has(first)) warn('Start a task title with a verb')
  }
  // Why: the parent.
  const parent = parentOf(db, item, kind)
  if (kind === 'goal') {
    if (item.horizon !== 'life') {
      if (!item.parentId) warn('Link it to the goal it serves, one horizon up')
      else if (!parent) err('Its parent goal does not exist')
      else {
        const gap = HORIZONS.indexOf(parent.horizon) - HORIZONS.indexOf(item.horizon)
        if (gap <= 0) err('Its parent must be on a longer horizon')
        else if (gap > 1) warn(`Its parent is ${gap} horizons up; link to one exactly one up`)
      }
    }
  } else if (!item.goalId) warn('Link it to the goal it serves')
  else if (!parent) err('Its goal does not exist')
  if (!str(item.why) && item.horizon !== 'life') warn('Say why: one sentence on how it serves its parent')
  // Requirements.
  if (!(item.requirements || []).length && !item.noRequirements) warn('List its requirements, or mark that nothing is needed first')
  for (const r of item.requirements || []) if (r.kind === 'item' && !findItem(db, r.itemId)) err(`A requirement points at an item that does not exist`)
  if ((item.requirements || []).some((r) => r.kind === 'item') && hasCycle(db, (kind === 'goal' ? 'g:' : 't:') + item.id)) err('Its requirements form a loop')
  // Proposal.
  if (!str(item.proposal?.approach) && !(item.proposal?.steps || []).length && !PROPOSAL_OPTIONAL.has(item.type)) warn('Write the proposal: how it will be done')
  // Acceptance criteria.
  if (!(item.criteria || []).length) warn('Add at least one acceptance criterion')
  for (const c of item.criteria || []) out.push(...criterionProblems(db, c))
  // Dates.
  if (item.start && !isDate(item.start)) err('Start date is not a valid date')
  if (item.end && !isDate(item.end)) err('End date is not a valid date')
  if (kind === 'task' && !item.end) warn('Set a target end date')
  if (kind === 'task' && item.date && !isDate(item.date)) err('Do date is not a valid date')
  const end = itemEnd(db, item, kind)
  if (item.start && end && item.start > end) err('It starts after it ends')
  if (kind === 'goal' && item.end && item.end > periodEnd(db, item.horizon, item.period)) err(`It ends after its own period (${item.period})`)
  if (parent && end) {
    const pend = itemEnd(db, parent, 'goal')
    if (pend && end > pend) err(`It ends after the goal it serves (${pend})`)
  }
  if (kind === 'task' && item.date && item.end && item.date > item.end) warn('Its do date is after its end date')
  // Estimate.
  if (kind === 'task' && !(item.estimate > 0)) warn('Estimate it in minutes')
  if (kind === 'task' && !item.priority) warn('Set a priority (must, should or could)')
  return out
}
export function quality(issues) {
  if (issues.some((i) => i.level === 'error')) return 'invalid'
  if (issues.length) return 'needs work'
  return 'complete'
}
export function lintPlan(db) {
  const rows = []
  for (const g of db.goals) rows.push({ ref: 'g:' + g.id, kind: 'goal', title: g.title, area: g.area, horizon: g.horizon, issues: lint(db, g, 'goal') })
  for (const t of db.tasks) rows.push({ ref: 't:' + t.id, kind: 'task', title: t.title, area: t.area, horizon: 'task', issues: lint(db, t, 'task') })
  for (const r of rows) r.quality = quality(r.issues)
  const count = (q) => rows.filter((r) => r.quality === q).length
  const common = {}
  for (const r of rows) for (const i of r.issues) common[i.msg.replace(/"[^"]*"/g, '"…"')] = (common[i.msg.replace(/"[^"]*"/g, '"…"')] || 0) + 1
  return {
    total: rows.length,
    complete: count('complete'),
    needsWork: count('needs work'),
    invalid: count('invalid'),
    commonProblems: Object.entries(common)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([msg, n]) => ({ msg, n })),
    items: rows
  }
}

// ---- routines ------------------------------------------------------------------------------------------------------
export function lintRoutine(db, r) {
  const out = []
  if (!str(r.criterion)) out.push({ level: 'warn', msg: 'Say what counts as a pass for one session' })
  const g = db.goals.find((x) => x.id === r.goalId)
  if (!r.goalId) out.push({ level: 'warn', msg: 'Link it to the habit goal it serves' })
  else if (!g) out.push({ level: 'error', msg: 'Its goal does not exist' })
  else if (g.type && g.type !== 'habit') out.push({ level: 'warn', msg: 'Routines should serve a goal of type Habit' })
  return out
}

// ---- templates -----------------------------------------------------------------------------------------------------
export const TEMPLATES = {
  goal: {
    outcome: {
      title: 'Signed offer for the next role at the target salary',
      why: 'Funds the goals above it.',
      requirements: [{ kind: 'resource', text: 'An up-to-date resume' }, { kind: 'time', text: '2 hours each weekday', amount: 10 }],
      proposal: { approach: 'Tailored applications and warm outreach; weekly pipeline count.', steps: [{ text: 'Shortlist roles' }, { text: 'Apply and follow up' }, { text: 'Prepare and interview' }] },
      criteria: [{ kind: 'check', text: 'Offer letter signed', evidence: 'The signed letter' }, { kind: 'check', text: 'Base pay at or above the target', evidence: 'The letter' }]
    },
    metric: {
      title: 'Run 5 km in under 30 minutes',
      why: 'A measurable fitness base.',
      requirements: [{ kind: 'resource', text: 'Running shoes and a watch' }],
      proposal: { approach: 'Three runs a week, one of them timed.', steps: [] },
      criteria: [{ kind: 'metric', text: '5 km time at or under 30 minutes', metricId: '', op: '<=', value: 30 }]
    },
    habit: {
      title: 'Lift three times a week',
      why: 'Strength is the long-term goal; consistency gets there.',
      requirements: [{ kind: 'resource', text: 'Gym access' }],
      proposal: { approach: 'Three fixed sessions, logged.', steps: [] },
      criteria: [{ kind: 'adherence', text: '80% of sessions over 8 weeks', routineId: '', pct: 80, windowDays: 56 }]
    },
    milestone: {
      title: 'Launch the website',
      why: 'A public home for the work.',
      requirements: [{ kind: 'money', text: 'Domain and hosting', amount: 100 }],
      proposal: { approach: 'Write, design, publish.', steps: [{ text: 'Write the pages' }, { text: 'Design' }, { text: 'Publish' }] },
      criteria: [{ kind: 'check', text: 'Live at its own address', evidence: 'The public link' }]
    },
    decision: {
      title: 'Choose between two places to live',
      why: 'The housing plan waits on it.',
      requirements: [{ kind: 'info', text: 'Prices, distances and winters for each' }],
      proposal: { approach: 'Write the criteria, score each option, visit the top one.', steps: [{ text: 'Option A: …' }, { text: 'Option B: …' }] },
      criteria: [{ kind: 'check', text: 'One option chosen and written down with reasons', evidence: 'The decision note' }]
    }
  },
  task: {
    action: {
      title: 'Book a meeting with an accountant',
      why: 'First step on the paperwork.',
      requirements: [{ kind: 'info', text: 'The documents they will ask for' }],
      proposal: { approach: 'Call the first firm; if no slot this week, the next two.', steps: [] },
      criteria: [{ kind: 'date', text: 'Meeting confirmed in writing', by: '' }]
    },
    deliverable: {
      title: 'Write the resume section for a project',
      why: 'Shows recent technical work.',
      requirements: [{ kind: 'info', text: 'Numbers and outcomes for the project' }],
      proposal: { approach: 'Three bullets: what, scale, result.', steps: [] },
      criteria: [{ kind: 'check', text: 'Section in the resume file, under 60 words', evidence: 'The file' }]
    },
    research: {
      title: 'Compare two degree programmes',
      why: 'Feeds the decision on where to enrol.',
      requirements: [{ kind: 'info', text: 'Transcripts' }],
      proposal: { approach: 'Questions: cost, transfer credit, time to finish.', steps: [{ text: 'Cost?' }, { text: 'Transfer credit?' }, { text: 'Time to finish?' }] },
      criteria: [{ kind: 'check', text: 'Each question answered with a recommendation', evidence: 'The notes' }]
    },
    appointment: {
      title: 'Attend the meeting',
      why: '',
      requirements: [],
      proposal: { approach: '', steps: [] },
      criteria: [{ kind: 'date', text: 'Attended', by: '' }]
    },
    admin: {
      title: 'Renew the registration',
      why: '',
      requirements: [{ kind: 'money', text: 'Fee', amount: 75 }],
      proposal: { approach: '', steps: [] },
      criteria: [{ kind: 'check', text: 'Confirmation received', evidence: 'The receipt' }]
    },
    practice: {
      title: 'Practise one section',
      why: '',
      requirements: [],
      proposal: { approach: '', steps: [] },
      criteria: [{ kind: 'check', text: 'Section passed at 80% or better', evidence: 'The score' }]
    }
  }
}

// ---- migration -----------------------------------------------------------------------------------------------------
// Empty by default: the user's own list lives in their plan file (Settings, Excluded topics), never in the code.
export const DEFAULT_POLICY = () => ({ excluded: [] })

/** Brings a v1 plan up to the current format in place. Returns true if anything changed. */
export function migrate(db) {
  if ((db.schemaVersion || 1) >= SCHEMA_VERSION) {
    db.policy ||= DEFAULT_POLICY()
    return false
  }
  const origin = (o) => (/\bYou said\b/.test(o.detail || '') ? 'mined' : 'claude')
  for (const g of db.goals || []) {
    if (!ITEM_STATUSES.includes(g.status)) g.status = 'active'
    g.requirements ||= []
    g.proposal ||= { approach: '', steps: [] }
    g.criteria ||= []
    g.origin ||= origin(g)
    g.source ||= 'Plan build, November 2026'
  }
  for (const t of db.tasks || []) {
    const check = db.days?.[t.date]?.checks?.['t:' + t.id]
    if (!ITEM_STATUSES.includes(t.status)) t.status = check?.status === 'done' ? 'done' : 'active'
    t.end ||= t.date
    t.requirements ||= []
    t.proposal ||= { approach: '', steps: [] }
    t.criteria ||= []
    t.origin ||= t.unplanned ? 'you' : origin(t)
    t.source ||= t.unplanned ? 'Check-in' : 'Plan build, November 2026'
  }
  db.policy ||= DEFAULT_POLICY()
  db.schemaVersion = SCHEMA_VERSION
  return true
}
