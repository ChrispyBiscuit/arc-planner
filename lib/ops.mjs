// The plan store and every operation on it. The dashboard (POST /api/op) and the MCP tools call the same table.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { today, addDays, dayPlan, score, goalsFor, periodsFor, ageOn, daysBetween, HORIZONS, REPEAT_UNITS } from '../public/shared.js'
import {
  migrate,
  lint,
  lintPlan,
  quality,
  evalItem,
  effectiveStatus,
  findItem,
  normRequirements,
  normProposal,
  normCriteria,
  GOAL_TYPES,
  TASK_TYPES,
  ITEM_STATUSES,
  PRIORITIES,
  ORIGINS,
  TEMPLATES,
  CLOSED,
  DEFAULT_POLICY,
  isDate as validDate,
  itemEnd,
  periodEnd,
  normDecision,
  dayLoad,
  focusFor,
  decisionsDue,
  minutesOf,
  DEFAULT_CAPACITY,
  isTime
} from '../public/model.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FILE = process.env.ARC_DATA || join(ROOT, 'data', 'plan.json')

const id = (p) => p + '_' + randomBytes(4).toString('hex')
const EMPTY = () => ({
  rev: 0,
  profile: { name: '', birthDate: '', lifeExpectancy: 85 },
  areas: [],
  goals: [],
  routines: [],
  tasks: [],
  days: {},
  metrics: [],
  phases: [],
  facts: [],
  proposals: [],
  revisions: []
})

export function load() {
  if (!existsSync(FILE)) {
    const db = EMPTY()
    migrate(db)
    return db
  }
  const db = { ...EMPTY(), ...JSON.parse(readFileSync(FILE, 'utf8')) }
  if (migrate(db)) {
    // Keep the pre-migration file once, untouched, before the first write in the new format.
    const bak = join(dirname(FILE), 'backups', 'plan-before-v2-format.json')
    if (!existsSync(bak)) {
      mkdirSync(dirname(bak), { recursive: true })
      copyFileSync(FILE, bak)
    }
  }
  return db
}

/** Thrown when a write was based on an older revision than the one on disk. */
export class StaleError extends Error {
  constructor(rev) {
    super(`The plan changed since you loaded it (now revision ${rev}). Reload and try again.`)
    this.code = 'STALE'
    this.rev = rev
  }
}

function save(db) {
  db.rev = (db.rev || 0) + 1
  db.updatedAt = new Date().toISOString()
  mkdirSync(dirname(FILE), { recursive: true })
  // One rolling backup per day, taken before that day's first write.
  const bak = join(dirname(FILE), 'backups', `plan-${today()}.json`)
  if (existsSync(FILE) && !existsSync(bak)) {
    mkdirSync(dirname(bak), { recursive: true })
    copyFileSync(FILE, bak)
  }
  const tmp = FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(db, null, 1))
  renameSync(tmp, FILE)
}

/** Replaces the whole plan with an exported one, keeping a copy of what was there. Dashboard only, not an MCP tool. */
export function importPlan(plan, basedOnRev) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.goals) || !Array.isArray(plan.routines) || !plan.profile) throw new Error('That file is not an Arc plan')
  const current = load()
  if (basedOnRev != null && +basedOnRev !== current.rev) throw new StaleError(current.rev)
  migrate(plan)
  if (existsSync(FILE)) {
    const bak = join(dirname(FILE), 'backups', `plan-before-import-${Date.now()}.json`)
    mkdirSync(dirname(bak), { recursive: true })
    copyFileSync(FILE, bak)
  }
  const db = { ...EMPTY(), ...plan, rev: current.rev || 0 }
  db.revisions = [...(db.revisions || []), { at: new Date().toISOString(), actor: 'you', summary: 'Plan imported from a file' }]
  save(db)
  return { goals: db.goals.length, routines: db.routines.length, tasks: db.tasks.length }
}

const need = (v, name) => {
  if (v === undefined || v === null || v === '') throw new Error(`Missing "${name}"`)
  return v
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const dateArg = (s) => {
  if (!s) return today()
  if (!isDate(s)) throw new Error(`Bad date "${s}" (use YYYY-MM-DD)`)
  return s
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const STATUSES = ['todo', 'done', 'partial', 'skipped']

function upsert(list, prefix, args, keys, defaults = {}) {
  let row = args.id ? list.find((x) => x.id === args.id) : null
  if (args.id && !row) throw new Error(`No item with id ${args.id}`)
  if (!row) {
    row = { id: id(prefix), ...defaults }
    list.push(row)
  }
  Object.assign(row, pick(args, keys))
  return row
}
const remove = (list, rid) => {
  const i = list.findIndex((x) => x.id === rid)
  if (i < 0) throw new Error(`No item with id ${rid}`)
  return list.splice(i, 1)[0]
}
const dayOf = (db, date) => (db.days[date] ||= {})

function setCheck(db, date, key, a) {
  if (a.status && !STATUSES.includes(a.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  const checks = (dayOf(db, date).checks ||= {})
  const c = (checks[key] ||= {})
  Object.assign(c, pick(a, ['status', 'actual', 'note']))
}

function rangeStats(db, from, to) {
  const days = []
  const byArea = {}
  const byRoutine = {}
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const p = dayPlan(db, d)
    days.push({ date: d, pct: p.score.pct, done: p.score.done, total: p.score.total, checkedIn: !!p.checkin })
    for (const it of p.items) {
      const a = (byArea[it.area] ||= { total: 0, done: 0, partial: 0, skipped: 0 })
      a.total++
      if (a[it.status] !== undefined) a[it.status]++
      if (it.kind === 'routine') {
        const r = (byRoutine[it.key] ||= { title: it.title, scheduled: 0, done: 0, partial: 0, skipped: 0 })
        r.scheduled++
        if (r[it.status] !== undefined) r[it.status]++
      }
    }
  }
  const pct = (x, total) => (total ? Math.round(((x.done + x.partial * 0.5) / total) * 100) : null)
  for (const a of Object.values(byArea)) a.pct = pct(a, a.total)
  for (const r of Object.values(byRoutine)) r.pct = pct(r, r.scheduled)
  const scored = days.filter((d) => d.total)
  const overall = scored.length ? Math.round(scored.reduce((s, d) => s + d.pct, 0) / scored.length) : null
  return { days, byArea, byRoutine, overall }
}

function streak(db, upTo) {
  let n = 0
  for (let d = upTo; n < 3650; d = addDays(d, -1)) {
    const s = dayPlan(db, d).score
    if (!s.total || s.pct < 80) {
      if (d === upTo && s.total && s.done + s.partial === 0) continue // today not started yet does not break a streak
      break
    }
    n++
  }
  return n
}

const metricSummary = (m) => {
  const e = [...(m.entries || [])].sort((a, b) => a.date.localeCompare(b.date))
  const last = e.at(-1)
  return { id: m.id, name: m.name, unit: m.unit, area: m.area, target: m.target ?? null, targetDate: m.targetDate || null, latest: last?.value ?? null, latestDate: last?.date ?? null, first: e[0]?.value ?? null, entries: e.length }
}

// ---- structured items --------------------------------------------------------------------------------------------
const STRUCT_KEYS = ['type', 'why', 'requirements', 'noRequirements', 'proposal', 'criteria', 'decision', 'start', 'end', 'estimate', 'status', 'outcome', 'origin', 'source']
const GOAL_KEYS = ['horizon', 'period', 'area', 'title', 'detail', 'measure', 'progress', 'parentId', 'metricId', ...STRUCT_KEYS]
const TASK_KEYS = ['date', 'title', 'area', 'target', 'detail', 'goalId', 'time', 'priority', ...STRUCT_KEYS]

/** Validates and normalises the structured fields in place; throws on values that can never be right. */
function prepStructured(a, kind) {
  const types = kind === 'goal' ? GOAL_TYPES : TASK_TYPES
  if (a.type !== undefined && a.type !== '' && !types[a.type]) throw new Error(`type must be one of ${Object.keys(types).join(', ')}`)
  if (a.status !== undefined && !ITEM_STATUSES.includes(a.status)) throw new Error(`status must be one of ${ITEM_STATUSES.join(', ')}`)
  if (a.priority !== undefined && a.priority !== '' && !PRIORITIES.includes(a.priority)) throw new Error(`priority must be one of ${PRIORITIES.join(', ')}`)
  if (a.origin !== undefined && !ORIGINS.includes(a.origin)) throw new Error(`origin must be one of ${ORIGINS.join(', ')}`)
  for (const k of ['start', 'end', 'date']) if (a[k] !== undefined && a[k] !== '' && !validDate(a[k])) throw new Error(`Bad ${k} "${a[k]}" (use YYYY-MM-DD)`)
  for (const k of ['start', 'end']) if (a[k] === '') a[k] = undefined
  if (a.estimate !== undefined) a.estimate = a.estimate === '' || a.estimate == null ? undefined : +a.estimate
  if (a.requirements !== undefined) a.requirements = normRequirements(a.requirements)
  if (a.proposal !== undefined) a.proposal = normProposal(a.proposal)
  if (a.criteria !== undefined) a.criteria = normCriteria(a.criteria)
  if (a.decision !== undefined) a.decision = normDecision(a.decision)
}

/**
 * Moves an item to done, dropped or back to active. Done needs every acceptance criterion met, unless an override
 * reason is given. Yes-or-no and date criteria are taken as met when `assert` is set (the user ticking the item).
 */
function closeItem(db, kind, item, a, actor) {
  const status = a.status
  if (status === 'done') {
    if (a.assert) {
      for (const c of item.criteria || []) {
        if (c.kind === 'check' && !c.met) c.met = true
        if (c.kind === 'date' && !c.met) Object.assign(c, { met: true, on: a.date || today() })
      }
    }
    const ev = evalItem(db, item, kind, a.date || today())
    const unmet = ev.criteria.filter((c) => !c.eval.met).map((c) => `${c.text || c.kind}: ${c.eval.label}`)
    if (unmet.length && !a.overrideReason) {
      const e = new Error(`Not all acceptance criteria are met:\n- ${unmet.join('\n- ')}\nMeet them, or close it with an override reason.`)
      e.code = 'CRITERIA'
      e.unmet = unmet
      throw e
    }
    item.status = 'done'
    item.outcome = { ...(item.outcome || {}), at: new Date().toISOString(), by: actor, ...(a.outcome ? { text: a.outcome } : {}), ...(a.lesson ? { lesson: a.lesson } : {}), ...(a.overrideReason ? { override: a.overrideReason } : {}) }
  } else if (status === 'dropped') {
    item.status = 'dropped'
    item.outcome = { ...(item.outcome || {}), at: new Date().toISOString(), by: actor, ...(a.outcome ? { text: a.outcome } : {}), ...(a.lesson ? { lesson: a.lesson } : {}) }
  } else {
    item.status = ITEM_STATUSES.includes(status) ? status : 'active'
  }
  return item
}

function upsertStructured(db, kind, a, actor) {
  const list = kind === 'goal' ? db.goals : db.tasks
  prepStructured(a, kind)
  const wantsClose = a.status === 'done' || a.status === 'dropped'
  const closing = { status: a.status, outcome: a.outcomeText, lesson: a.lesson, overrideReason: a.overrideReason }
  if (wantsClose) delete a.status
  const existing = a.id ? list.find((x) => x.id === a.id) : null
  if (a.id && !existing) throw new Error(`No item with id ${a.id}`)
  let row
  if (existing) {
    row = Object.assign(existing, pick(a, kind === 'goal' ? GOAL_KEYS : TASK_KEYS))
    row.updatedAt = new Date().toISOString()
  } else {
    row = { id: id(kind === 'goal' ? 'gl' : 'tk'), status: 'active', requirements: [], proposal: { approach: '', steps: [] }, criteria: [], origin: actor === 'claude' ? 'claude' : 'you', createdAt: new Date().toISOString() }
    if (kind === 'goal') row.progress = 0
    Object.assign(row, pick(a, kind === 'goal' ? GOAL_KEYS : TASK_KEYS))
    list.push(row)
  }
  if (kind === 'task' && !row.end && row.date) row.end = row.date
  const issues = lint(db, row, kind)
  // Claude's new items that do not pass the linter wait as proposals; they are never accepted silently.
  if (!existing && actor === 'claude' && quality(issues) !== 'complete') row.status = 'proposed'
  if (kind === 'task' && actor === 'claude' && (!existing || a.date !== undefined || a.estimate !== undefined)) checkCapacity(db, row)
  if (wantsClose) closeItem(db, kind, row, closing, actor)
  return { ...row, quality: quality(issues), issues }
}

function describeItem(db, f) {
  const { item, kind } = f
  const ev = evalItem(db, item, kind)
  const issues = lint(db, item, kind)
  const chain = []
  let p = db.goals.find((g) => g.id === (kind === 'goal' ? item.parentId : item.goalId))
  while (p && chain.length < 6) {
    chain.push({ ref: 'g:' + p.id, horizon: p.horizon, period: p.period, title: p.title })
    p = db.goals.find((g) => g.id === p.parentId)
  }
  const children =
    kind === 'goal'
      ? {
          goals: db.goals.filter((g) => g.parentId === item.id).map((g) => ({ ref: 'g:' + g.id, title: g.title, horizon: g.horizon, period: g.period, status: effectiveStatus(db, g, 'goal') })),
          tasks: db.tasks.filter((t) => t.goalId === item.id).map((t) => ({ ref: 't:' + t.id, title: t.title, date: t.date, status: effectiveStatus(db, t, 'task') })),
          routines: db.routines.filter((r) => r.goalId === item.id).map((r) => ({ id: r.id, title: r.title }))
        }
      : undefined
  return { ref: f.ref, kind, ...item, effectiveStatus: effectiveStatus(db, item, kind), progress: ev.progress, criteriaMet: ev.allMet, criteria: ev.criteria.map((c) => ({ ...c, met: c.eval.met, detail: c.eval.label, eval: undefined })), quality: quality(issues), issues, parents: chain, children }
}

// ---- capacity and focus ------------------------------------------------------------------------------------------
/** The first day from `from` (up to `until`, or 30 days) where `minutes` more still fits under capacity. */
export function nextFreeDay(db, minutes, from, until) {
  const last = until && until >= from ? until : addDays(from, 30)
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const l = dayLoad(db, d)
    if (l.minutes + minutes <= l.capacity) return d
  }
  return null
}
const taskMinutes = (db, t) => minutesOf(db, { kind: 'task', estimate: t.estimate, target: t.target })
/** Refuses a task from Claude that would put its day over capacity, naming the next day with room. */
function checkCapacity(db, task) {
  if (task.status === 'proposed' || CLOSED.has(task.status) || !task.date) return
  const load = dayLoad(db, task.date)
  if (!load.over) return
  const mins = taskMinutes(db, task)
  const others = { ...db, tasks: db.tasks.filter((t) => t !== task) }
  const free = nextFreeDay(others, mins, addDays(task.date, 1), task.end && task.end > task.date ? task.end : undefined)
  const e = new Error(`${task.date} would be over capacity (${load.minutes} of ${load.capacity} minutes planned). ${free ? `The next day with room for ${mins} minutes is ${free}.` : 'No day before its end date has room; ask the user what to drop or move.'}`)
  e.code = 'CAPACITY'
  e.nextFreeDay = free
  throw e
}
/** Moves could-then-should tasks off days over capacity to the next day with room before their end date. Must tasks and focus items stay. */
function balance(db, from, to) {
  const moves = []
  const unresolved = []
  const rank = { could: 0, should: 1, '': 2 }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let load = dayLoad(db, d)
    if (!load.over) continue
    const focus = new Set(db.days[d]?.focus || []) // only focus the user chose is protected, not the suggestion
    const movable = db.tasks
      .filter((t) => t.date === d && !CLOSED.has(t.status) && t.status !== 'proposed' && t.priority !== 'must' && !focus.has('t:' + t.id) && !(db.days[d]?.checks || {})['t:' + t.id]?.status)
      .sort((a, b) => (rank[a.priority || ''] ?? 2) - (rank[b.priority || ''] ?? 2) || String(b.end || '').localeCompare(String(a.end || '')))
    for (const t of movable) {
      if (!load.over) break
      const until = t.end && t.end > d ? t.end : null
      if (!until) continue
      const mins = taskMinutes(db, t)
      const free = nextFreeDay({ ...db, tasks: db.tasks.filter((x) => x !== t) }, mins, addDays(d, 1), until)
      if (!free) continue
      moves.push({ ref: 't:' + t.id, title: t.title, from: d, to: free, minutes: mins })
      t.date = free
      load = dayLoad(db, d)
    }
    if (load.over) unresolved.push({ date: d, minutes: load.minutes, capacity: load.capacity })
  }
  return { moves, unresolved }
}

// ---- proposals and triage -----------------------------------------------------------------------------------------
const PROPOSABLE = new Set(['type', 'title', 'why', 'requirements', 'noRequirements', 'proposal', 'criteria', 'decision', 'start', 'end', 'estimate', 'priority', 'parentId', 'goalId', 'date', 'area', 'target', 'detail'])

const ROUTINE_FIELDS = new Set(['title', 'target', 'estimate', 'criterion', 'days', 'start', 'end', 'active', 'goalId', 'area', 'time', 'detail'])
/** A goal, task or routine by ref ("g:", "t:", "r:"). Routines are not goals or tasks, so findItem does not return them. */
export function findAny(db, ref) {
  if (String(ref).startsWith('r:')) {
    const r = db.routines.find((x) => 'r:' + x.id === ref)
    return r ? { kind: 'routine', item: r, ref } : null
  }
  return findItem(db, ref)
}

function proposeChange(db, c, actor, batch, source) {
  if (String(c.ref).startsWith('r:')) return proposeRoutineChange(db, c, actor, batch, source)
  const f = findItem(db, c.ref)
  if (!f) throw new Error(`No item ${c.ref}`)
  if (!['update', 'drop'].includes(c.action)) throw new Error(`${c.ref}: action must be "update" or "drop"`)
  if (!c.reason) throw new Error(`${c.ref}: a proposal needs a reason`)
  const fields = {}
  if (c.action === 'update') {
    for (const [k, v] of Object.entries(c.fields || {})) {
      if (!PROPOSABLE.has(k)) throw new Error(`${c.ref}: "${k}" cannot be proposed`)
      fields[k] = v
    }
    if (!Object.keys(fields).length) throw new Error(`${c.ref}: an update needs at least one field`)
    for (const k of ['parentId', 'goalId']) {
      if (typeof fields[k] === 'string' && fields[k].startsWith('g:')) fields[k] = fields[k].slice(2)
      if (fields[k] && !db.goals.some((g) => g.id === fields[k])) throw new Error(`${c.ref}: ${k} ${fields[k]} does not exist`)
    }
    prepStructured(fields, f.kind)
  }
  db.proposals = db.proposals.filter((p) => p.ref !== f.ref)
  const p = { id: id('pr'), ref: f.ref, kind: f.kind, area: fields.area || f.item.area, title: f.item.title, action: c.action, fields, reason: c.reason, by: actor, batch: batch || '', source: source || '', createdAt: new Date().toISOString() }
  db.proposals.push(p)
  return p
}

function proposeRoutineChange(db, c, actor, batch, source) {
  const f = findAny(db, c.ref)
  if (!f) throw new Error(`No routine ${c.ref}`)
  if (!['update', 'drop'].includes(c.action)) throw new Error(`${c.ref}: action must be "update" or "drop"`)
  if (!c.reason) throw new Error(`${c.ref}: a proposal needs a reason`)
  const fields = {}
  if (c.action === 'update') {
    for (const [k, v] of Object.entries(c.fields || {})) {
      if (!ROUTINE_FIELDS.has(k)) throw new Error(`${c.ref}: "${k}" cannot be proposed for a routine`)
      fields[k] = v
    }
    if (!Object.keys(fields).length) throw new Error(`${c.ref}: an update needs at least one field`)
    if (fields.days !== undefined && (!Array.isArray(fields.days) || fields.days.some((d) => !(d >= 0 && d <= 6)))) throw new Error(`${c.ref}: days are weekday numbers 0 to 6`)
    if (fields.estimate !== undefined && !(+fields.estimate >= 0)) throw new Error(`${c.ref}: estimate is minutes, 0 or more`)
    if (typeof fields.goalId === 'string' && fields.goalId.startsWith('g:')) fields.goalId = fields.goalId.slice(2)
    if (fields.goalId && !db.goals.some((g) => g.id === fields.goalId)) throw new Error(`${c.ref}: goalId ${fields.goalId} does not exist`)
    for (const k of ['start', 'end']) if (fields[k] !== undefined && fields[k] !== '' && !validDate(fields[k])) throw new Error(`${c.ref}: bad ${k}`)
  }
  db.proposals = db.proposals.filter((p) => p.ref !== f.ref)
  const p = { id: id('pr'), ref: f.ref, kind: 'routine', area: fields.area || f.item.area, title: f.item.title, action: c.action, fields, reason: c.reason, by: actor, batch: batch || '', source: source || '', createdAt: new Date().toISOString() }
  db.proposals.push(p)
  return p
}

function applyProposal(db, p, actor) {
  if (p.kind === 'routine') {
    const f = findAny(db, p.ref)
    if (!f) throw new Error(`${p.ref} no longer exists`)
    if (p.action === 'drop') return Object.assign(f.item, { active: false, end: addDays(today(), -1) })
    return Object.assign(f.item, clone(p.fields))
  }
  const f = findItem(db, p.ref)
  if (!f) throw new Error(`${p.ref} no longer exists`)
  if (p.action === 'drop') return closeItem(db, f.kind, f.item, { status: 'dropped', outcome: `Dropped in review: ${p.reason}` }, actor)
  const r = upsertStructured(db, f.kind, { ...clone(p.fields), id: f.item.id }, actor)
  f.item.reviewedAt = new Date().toISOString()
  if (f.item.status === 'proposed') f.item.status = 'active'
  return r
}
const clone = (x) => JSON.parse(JSON.stringify(x))

function overdue(db, date) {
  const rows = []
  for (const [kind, list] of [['goal', db.goals], ['task', db.tasks]]) {
    for (const x of list) {
      const s = effectiveStatus(db, x, kind, date)
      if (s === 'missed' || s === 'blocked') rows.push({ ref: (kind === 'goal' ? 'g:' : 't:') + x.id, kind, status: s, title: x.title, area: x.area, end: itemEnd(db, x, kind), date: x.date, horizon: x.horizon, period: x.period })
    }
  }
  rows.sort((a, b) => String(a.end).localeCompare(String(b.end)))
  return { missed: rows.filter((r) => r.status === 'missed'), blocked: rows.filter((r) => r.status === 'blocked') }
}

function syncTaskFromCheck(db, key, status, date, actor) {
  if (!key.startsWith('t:')) return null
  const t = db.tasks.find((x) => 't:' + x.id === key)
  if (!t) return null
  if (status === 'done' && t.status !== 'done') return closeItem(db, 'task', t, { status: 'done', assert: true, date }, actor)
  if (status && status !== 'done' && t.status === 'done') t.status = 'active'
  return t
}

// ---- operations --------------------------------------------------------------------------------------------------
// Each: { desc, args (JSON-schema properties), required, write, run(db, args) -> result }. `write` ops are saved and
// recorded in the revision log with the actor (you in the dashboard, or Claude over MCP).

const S = { type: 'string' }
const N = { type: 'number' }
const DATE = { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' }
const REPEAT = { type: 'object', description: 'How it repeats: { every: "day" | "week" | "month" | "year", interval: 1-99 }, counted from start.' }
const AREA = { type: 'string', description: 'Area id (see get_overview.areas), e.g. health, career, learning.' }
const REQS = {
  type: 'array',
  description: 'What must be true or available first. kind "item" points at another goal or task (itemId "g:<id>" or "t:<id>") and blocks until it is done; other kinds block only when blocking=true and met=false.',
  items: { type: 'object', properties: { kind: { type: 'string', enum: ['item', 'money', 'time', 'resource', 'info', 'person'] }, text: S, itemId: S, amount: N, met: { type: 'boolean' }, blocking: { type: 'boolean' } }, required: ['kind'] }
}
const PROPOSAL = { type: 'object', description: 'How it will be done.', properties: { approach: S, steps: { type: 'array', items: { type: 'object', properties: { text: S, done: { type: 'boolean' } }, required: ['text'] } } } }
const CRITERIA = {
  type: 'array',
  description:
    'Acceptance criteria; all must be met for done. Kinds: "check" (text + evidence, ticked when true), "metric" (metricId, op <= >= < > =, value; checked from readings), "count" (of children|tasks|instances, value), "adherence" (routineId, pct, windowDays; for habits), "date" (by YYYY-MM-DD). Each must be checkable by someone else: no "better" or "more" without a number.',
  items: {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['check', 'metric', 'count', 'adherence', 'date'] }, text: S, evidence: S, met: { type: 'boolean' }, metricId: S, op: { type: 'string', enum: ['<=', '>=', '<', '>', '='] }, value: N, of: { type: 'string', enum: ['children', 'tasks', 'instances'] }, routineId: S, pct: N, windowDays: N, by: S },
    required: ['kind', 'text']
  }
}

export const OPS = {
  get_overview: {
    desc: 'Start here. Today\'s targets and check-in, the active goal at every horizon (week, month, year, decade, life), the last 7 days of completion, the streak, latest metrics, areas, routines and recent plan revisions.',
    args: { date: DATE },
    run(db, a) {
      const date = dateArg(a.date)
      const p = periodsFor(date)
      const last7 = rangeStats(db, addDays(date, -7), addDays(date, -1))
      return {
        date,
        profile: { ...db.profile, age: ageOn(db.profile.birthDate, date) },
        areas: db.areas,
        today: dayPlan(db, date),
        focus: focusFor(db, date),
        load: dayLoad(db, date),
        decisionsDue: decisionsDue(db, date, 7),
        goals: Object.fromEntries(HORIZONS.map((h) => [h, goalsFor(db, h, p[h]).filter((g) => g.status !== 'dropped')])),
        periods: p,
        last7: { overall: last7.overall, days: last7.days, daysWithoutCheckIn: last7.days.filter((d) => !d.checkedIn).map((d) => d.date) },
        streakDays: streak(db, date),
        metrics: db.metrics.map(metricSummary),
        routines: db.routines,
        phases: db.phases,
        planQuality: (({ total, complete, needsWork, invalid, commonProblems }) => ({ total, complete, needsWork, invalid, commonProblems: commonProblems.slice(0, 5) }))(lintPlan(db)),
        excludedTopics: (db.policy || DEFAULT_POLICY()).excluded,
        inbox: { changes: db.proposals.length, newItems: db.goals.filter((g) => g.status === 'proposed').length + db.tasks.filter((t) => t.status === 'proposed').length },
        overdue: (({ missed, blocked }) => ({ missed: missed.length, blocked: blocked.length, oldest: missed.slice(0, 10) }))(overdue(db, date)),
        recentRevisions: db.revisions.slice(-5)
      }
    }
  },
  get_day: {
    desc: 'One day\'s targets (routines plus one-off tasks) with status, actuals, the brief and the check-in.',
    args: { date: DATE },
    run(db, a) {
      const date = dateArg(a.date)
      const plan = dayPlan(db, date)
      return { ...plan, focus: focusFor(db, date, plan), load: dayLoad(db, date, plan) }
    }
  },
  get_range: {
    desc: 'Every day between two dates with its targets and score. Use for a week or month in detail.',
    args: { from: DATE, to: DATE },
    required: ['from', 'to'],
    run(db, a) {
      const from = dateArg(a.from)
      const to = dateArg(a.to)
      if (daysBetween(from, to) > 120) throw new Error('Range is limited to 120 days; use get_performance for longer spans')
      const out = []
      for (let d = from; d <= to; d = addDays(d, 1)) out.push(dayPlan(db, d))
      return out
    }
  },
  get_performance: {
    desc: 'Performance over a span (default: last 30 days): completion per day, per area and per routine, the current streak, metric movement and goal status counts. Use this before re-planning.',
    args: { from: DATE, to: DATE },
    run(db, a) {
      const to = dateArg(a.to)
      const from = a.from ? dateArg(a.from) : addDays(to, -29)
      const goals = {}
      for (const g of db.goals) {
        const k = (goals[g.horizon] ||= {})
        const s = effectiveStatus(db, g, 'goal', to)
        k[s] = (k[s] || 0) + 1
      }
      const metrics = db.metrics.map((m) => {
        const e = (m.entries || []).filter((x) => x.date >= from && x.date <= to).sort((x, y) => x.date.localeCompare(y.date))
        return { ...metricSummary(m), inRange: e.length, change: e.length > 1 ? +(e.at(-1).value - e[0].value).toFixed(2) : null }
      })
      return { from, to, ...rangeStats(db, from, to), streakDays: streak(db, to), metrics, goals }
    }
  },
  set_item_status: {
    desc: 'Mark one of a day\'s targets. key comes from get_day (e.g. "r:rt_ab12" or "t:tk_cd34").',
    args: { date: DATE, key: S, status: { type: 'string', enum: STATUSES }, actual: { type: 'string', description: 'What actually happened, e.g. "4x8 @ 185" or "35 min".' }, note: S },
    required: ['key'],
    write: true,
    run(db, a, ctx) {
      const date = dateArg(a.date)
      setCheck(db, date, need(a.key, 'key'), a)
      // A one-off target marked done closes the task itself, which needs its acceptance criteria met.
      if (a.status) syncTaskFromCheck(db, a.key, a.status, date, ctx.actor)
      return dayPlan(db, date)
    }
  },
  check_in: {
    desc: 'Record what happened on a day in one call: a summary, sleep/energy/mood, item results and metric readings. Items are matched by key, or by title (case-insensitive, partial); an unmatched title is added as an unplanned task. Call this when the user reports their day.',
    args: {
      date: DATE,
      summary: { type: 'string', description: 'What happened, in the user\'s words or a faithful digest.' },
      wins: S,
      misses: S,
      sleepHours: N,
      energy: { type: 'number', description: '1-5' },
      mood: { type: 'number', description: '1-5' },
      items: { type: 'array', items: { type: 'object', properties: { key: S, title: S, status: { type: 'string', enum: STATUSES }, actual: S, note: S, area: AREA } } },
      metrics: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'Metric id or name' }, value: N }, required: ['id', 'value'] } }
    },
    write: true,
    run(db, a, ctx) {
      const date = dateArg(a.date)
      const day = dayOf(db, date)
      const unmetCriteria = []
      const fields = pick(a, ['summary', 'wins', 'misses', 'sleepHours', 'energy', 'mood'])
      if (Object.keys(fields).length) day.checkin = { ...(day.checkin || {}), ...fields, at: new Date().toISOString() }
      const unmatched = []
      for (const it of a.items || []) {
        const plan = dayPlan(db, date).items
        let key = it.key && plan.find((p) => p.key === it.key)?.key
        if (!key && it.title) {
          const q = it.title.toLowerCase()
          key = (plan.find((p) => p.title.toLowerCase() === q) || plan.find((p) => p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase())))?.key
        }
        if (!key) {
          if (!it.title) throw new Error(`No target with key ${it.key} on ${date}`)
          const t = { id: id('tk'), date, end: date, title: it.title, area: it.area || 'life', unplanned: true, status: 'active', requirements: [], proposal: { approach: '', steps: [] }, criteria: [], origin: ctx.actor === 'claude' ? 'claude' : 'you', source: `Check-in ${date}`, createdAt: new Date().toISOString() }
          db.tasks.push(t)
          key = 't:' + t.id
          unmatched.push(it.title)
        }
        const status = it.status || 'done'
        setCheck(db, date, key, { ...it, status })
        // Metric logging below may be what meets a criterion, so tasks are closed after the readings are in.
        if (key.startsWith('t:')) unmetCriteria.push({ key, status })
      }
      for (const m of a.metrics || []) logMetric(db, m.id, date, m.value)
      const stillOpen = []
      for (const u of unmetCriteria) {
        try {
          syncTaskFromCheck(db, u.key, u.status, date, ctx.actor)
        } catch (e) {
          if (e.code !== 'CRITERIA') throw e
          stillOpen.push({ key: u.key, unmet: e.unmet })
        }
      }
      return { ...dayPlan(db, date), addedAsUnplanned: unmatched, tasksNotClosed: stillOpen }
    }
  },
  plan_day: {
    desc: 'Set a day\'s plan: a short brief shown at the top of the day, one-off tasks to add, and routines to hide for that day (rest day, travel, illness). replace=true first removes the day\'s existing one-off tasks that have no recorded result.',
    args: {
      date: DATE,
      brief: { type: 'string', description: 'Two or three sentences: the focus for the day and why.' },
      tasks: { type: 'array', description: 'Each task takes the same fields as upsert_task (type, why, requirements, proposal, criteria, end, estimate, priority, goalId).', items: { type: 'object', properties: { title: S, area: AREA, target: S, detail: S, goalId: S, time: { type: 'string', enum: ['am', '', 'pm'] } }, required: ['title', 'area'] } },
      hideRoutines: { type: 'array', items: S, description: 'Routine ids to leave out of this day.' },
      focus: { type: 'array', items: S, maxItems: 3, description: 'Up to three keys or titles to lead the day.' },
      replace: { type: 'boolean' }
    },
    write: true,
    run(db, a, ctx) {
      const date = dateArg(a.date)
      const day = dayOf(db, date)
      if (a.brief !== undefined) day.brief = a.brief
      if (a.replace) db.tasks = db.tasks.filter((t) => t.date !== date || (day.checks || {})['t:' + t.id])
      const added = []
      for (const t of a.tasks || []) {
        const r = upsertStructured(db, 'task', { ...t, id: undefined, date }, ctx.actor)
        added.push({ id: r.id, title: r.title, status: r.status, quality: r.quality, issues: r.issues })
      }
      if (a.hideRoutines) day.hidden = a.hideRoutines.map((r) => (r.startsWith('r:') ? r : 'r:' + r))
      if (a.focus) OPS.set_focus.run(db, { date, keys: a.focus }, ctx)
      return { ...dayPlan(db, date), added, focus: focusFor(db, date), load: dayLoad(db, date) }
    }
  },
  upsert_task: {
    desc: 'Add a task (a one-off target), or edit one (pass id). Every task needs: a type, a verb-first title, the goal it serves (goalId), why, requirements (or noRequirements=true), a proposal (approach and steps), at least one checkable acceptance criterion, a target end date, an estimate in minutes and a priority. date is the day it sits on the plan (the do date); end is when it must be done. The result includes the linter verdict; new tasks from Claude that are not complete are saved as proposals. To close a task use close_item. See get_templates for examples.',
    args: {
      id: S,
      type: { type: 'string', enum: Object.keys(TASK_TYPES) },
      title: { type: 'string', description: 'Verb first, e.g. "Book a meeting with a tax professional".' },
      area: AREA,
      goalId: { type: 'string', description: 'The goal this task serves.' },
      why: { type: 'string', description: 'One sentence on how it serves that goal.' },
      requirements: REQS,
      noRequirements: { type: 'boolean', description: 'True when nothing is needed first.' },
      proposal: PROPOSAL,
      criteria: CRITERIA,
      decision: { type: 'object', description: 'For type decision: { question, options: [{ text, notes }], reviewBy, affects: [refs] }. Record the choice with decide.' },
      date: { type: 'string', description: 'Do date, YYYY-MM-DD. Defaults to today.' },
      start: DATE,
      end: { type: 'string', description: 'Target end date, YYYY-MM-DD. Defaults to the do date.' },
      estimate: { type: 'number', description: 'Minutes.' },
      priority: { type: 'string', enum: PRIORITIES },
      target: { type: 'string', description: 'Short amount shown on the day, e.g. "45 min".' },
      detail: S,
      time: { type: 'string', enum: ['am', '', 'pm'] },
      status: { type: 'string', enum: ITEM_STATUSES },
      origin: { type: 'string', enum: ORIGINS },
      source: { type: 'string', description: 'Where this came from, e.g. "Check-in 2026-11-21" or a conversation date.' },
      overrideReason: { type: 'string', description: 'Only with status "done" when criteria are unmet.' }
    },
    write: true,
    run(db, a, ctx) {
      if (!a.id) {
        need(a.title, 'title')
        a.date = dateArg(a.date)
        a.area ||= 'life'
      }
      return upsertStructured(db, 'task', a, ctx.actor)
    }
  },
  delete_task: { desc: 'Remove a one-off target.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.tasks, a.id) },
  list_goals: {
    desc: 'Goals, optionally filtered. horizon is week | month | year | decade | life. period is "2026-W47", "2026-11", "2026", "2020" (the 2020s) or "life".',
    args: { horizon: { type: 'string', enum: HORIZONS }, period: S, area: AREA, status: { type: 'string', enum: ['proposed', 'accepted', 'active', 'blocked', 'missed', 'done', 'dropped'], description: 'Effective status (blocked and missed are derived).' }, type: { type: 'string', enum: Object.keys(GOAL_TYPES) }, quality: { type: 'string', enum: ['complete', 'needs work', 'invalid'] } },
    run: (db, a) =>
      db.goals
        .map((g) => ({ ...g, effectiveStatus: effectiveStatus(db, g, 'goal'), quality: quality(lint(db, g, 'goal')), progress: evalItem(db, g, 'goal').progress }))
        .filter((g) => (!a.horizon || g.horizon === a.horizon) && (!a.period || g.period === a.period) && (!a.area || g.area === a.area) && (!a.status || g.effectiveStatus === a.status) && (!a.type || g.type === a.type) && (!a.quality || g.quality === a.quality))
  },
  upsert_goal: {
    desc: 'Create a goal, or edit one (pass id). Every goal needs: a type (outcome, metric, habit, milestone, decision), an outcome-style title, a parent exactly one horizon up (parentId; not for life goals), why, requirements (or noRequirements=true), a proposal, at least one checkable acceptance criterion, and an end date inside its period (defaults to the end of the period). The result includes the linter verdict; new goals from Claude that are not complete are saved as proposals. To close a goal use close_item. See get_templates for examples.',
    args: {
      id: S,
      type: { type: 'string', enum: Object.keys(GOAL_TYPES) },
      horizon: { type: 'string', enum: HORIZONS },
      period: { type: 'string', description: '"2026-W47" | "2026-11" | "2026" | "2020" | "life"' },
      title: { type: 'string', description: 'The outcome, e.g. "Signed offer for the next role at the target salary".' },
      area: AREA,
      parentId: S,
      why: S,
      requirements: REQS,
      noRequirements: { type: 'boolean' },
      proposal: PROPOSAL,
      criteria: CRITERIA,
      decision: { type: 'object', description: 'For type decision: { question, options: [{ text, notes }], reviewBy, affects: [refs] }. Record the choice with decide.' },
      start: DATE,
      end: { type: 'string', description: 'Target end date, YYYY-MM-DD; must not be after the end of its period or its parent.' },
      estimate: { type: 'number', description: 'Total hours, optional.' },
      detail: S,
      status: { type: 'string', enum: ITEM_STATUSES },
      progress: { type: 'number', description: 'Manual progress 0-100, used only when the goal has no criteria.' },
      metricId: S,
      origin: { type: 'string', enum: ORIGINS },
      source: S,
      overrideReason: { type: 'string', description: 'Only with status "done" when criteria are unmet.' }
    },
    write: true,
    run(db, a, ctx) {
      if (!a.id) {
        need(a.title, 'title')
        need(a.horizon, 'horizon')
        if (!HORIZONS.includes(a.horizon)) throw new Error(`horizon must be one of ${HORIZONS.join(', ')}`)
        a.period = a.horizon === 'life' ? 'life' : need(a.period, 'period')
        a.area ||= 'life'
      }
      return upsertStructured(db, 'goal', a, ctx.actor)
    }
  },
  get_item: {
    desc: 'One goal or task in full: its fields, effective status, criteria evaluated against current data, linter issues, parents up to the life goal, and children.',
    args: { ref: { type: 'string', description: '"g:<goal id>" or "t:<task id>" (a bare id also works).' } },
    required: ['ref'],
    run(db, a) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      return describeItem(db, f)
    }
  },
  check_criteria: {
    desc: 'Evaluate an item\'s acceptance criteria against current data (metric readings, children, routine adherence). Read-only.',
    args: { ref: S, date: DATE },
    required: ['ref'],
    run(db, a) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      const ev = evalItem(db, f.item, f.kind, dateArg(a.date))
      return { ref: f.ref, allMet: ev.allMet, progress: ev.progress, criteria: ev.criteria.map((c) => ({ id: c.id, kind: c.kind, text: c.text, met: c.eval.met, detail: c.eval.label })) }
    }
  },
  update_criterion: {
    desc: 'Tick or untick one yes-or-no or date criterion on an item, with the evidence. Use when the user reports that something is true.',
    args: { ref: S, criterionId: S, met: { type: 'boolean' }, evidence: S, on: DATE },
    required: ['ref', 'criterionId', 'met'],
    write: true,
    run(db, a) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      const c = (f.item.criteria || []).find((x) => x.id === a.criterionId)
      if (!c) throw new Error(`No criterion ${a.criterionId} on ${f.ref}`)
      if (!['check', 'date'].includes(c.kind)) throw new Error(`A ${c.kind} criterion is checked from data, not ticked`)
      c.met = !!a.met
      if (a.evidence) c.evidence = a.evidence
      if (c.kind === 'date') c.on = a.met ? dateArg(a.on) : undefined
      return describeItem(db, f)
    }
  },
  close_item: {
    desc: 'Close a goal or task: "done" (all acceptance criteria must be met, or give overrideReason), "dropped" (no longer wanted), or reopen with "active". Record what happened and one lesson.',
    args: { ref: S, status: { type: 'string', enum: ['done', 'dropped', 'active'] }, outcome: { type: 'string', description: 'What happened.' }, lesson: S, overrideReason: S },
    required: ['ref', 'status'],
    write: true,
    run(db, a, ctx) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      closeItem(db, f.kind, f.item, a, ctx.actor)
      return describeItem(db, f)
    }
  },
  lint_plan: {
    desc: 'The plan linter over every goal and task: how many are complete, need work or are invalid, the most common problems, and (with list=true) each item\'s issues. Filter by area or quality.',
    args: { area: AREA, quality: { type: 'string', enum: ['complete', 'needs work', 'invalid'] }, list: { type: 'boolean' }, limit: N },
    run(db, a) {
      const r = lintPlan(db)
      const items = r.items.filter((i) => (!a.area || i.area === a.area) && (!a.quality || i.quality === a.quality))
      return { total: r.total, complete: r.complete, needsWork: r.needsWork, invalid: r.invalid, commonProblems: r.commonProblems, ...(a.list ? { items: items.slice(0, a.limit || 100) } : {}) }
    }
  },
  get_templates: {
    desc: 'A worked example of every goal type and task type in the required structure. Follow these when creating items.',
    args: {},
    run: () => TEMPLATES
  },
  get_policy: {
    desc: 'The user\'s standing rules: topics excluded from the plan (writes that mention them are refused). Read this before adding anything personal.',
    args: {},
    run: (db) => db.policy || DEFAULT_POLICY()
  },
  set_policy: {
    desc: 'Change the excluded topics. Dashboard only.',
    userOnly: true,
    args: { excluded: { type: 'array', items: S } },
    write: true,
    run(db, a) {
      db.policy ||= DEFAULT_POLICY()
      if (a.excluded) db.policy.excluded = a.excluded.map((x) => String(x).trim()).filter(Boolean)
      return db.policy
    }
  },
  delete_goal: { desc: 'Delete a goal. Prefer status "dropped" to keep the history.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.goals, a.id) },
  list_routines: { desc: 'Recurring targets that populate each day automatically.', args: {}, run: (db) => db.routines },
  upsert_routine: {
    desc: 'Create or edit a recurring target. repeat is { every: day | week | month | year, interval: n } counted from start (default every week); weekly ones use days, weekday numbers 0-6 with 0 = Sunday (omit for every day). Monthly ones land on the start date’s day of the month, yearly on its month and day. start/end bound the dates it applies to; set active=false to pause it. To change a programme (e.g. new training block), end the old routine and start a new one so history stays true.',
    args: { id: S, title: S, area: AREA, target: { type: 'string', description: 'The measurable target, e.g. "45 min zone 2" or "5 applications".' }, criterion: { type: 'string', description: 'What counts as a pass for one session, checkable, e.g. "at least 30 minutes" or "one section at 80% or better".' }, detail: S, days: { type: 'array', items: N }, start: DATE, end: DATE, active: { type: 'boolean' }, goalId: { type: 'string', description: 'The Habit goal this routine serves.' }, estimate: { type: 'number', description: 'Minutes one session takes; counts toward daily capacity.' }, startTime: { type: 'string', description: 'Usual start time, HH:MM 24-hour; days can override it.' }, time: { type: 'string', enum: ['am', '', 'pm'] }, repeat: REPEAT },
    write: true,
    run(db, a) {
      if (!a.id) {
        need(a.title, 'title')
        a.area ||= 'life'
        a.start ||= today()
      }
      if (a.startTime != null && a.startTime !== '' && !isTime(a.startTime)) throw new Error('startTime must be HH:MM, 24-hour')
      if (a.repeat !== undefined) a.repeat = checkRepeat(a.repeat)
      return upsert(db.routines, 'rt', a, ['title', 'area', 'target', 'criterion', 'estimate', 'startTime', 'detail', 'days', 'start', 'end', 'active', 'goalId', 'time', 'repeat'], { active: true })
    }
  },
  delete_routine: { desc: 'Delete a routine and its place in past days. To stop one going forward, set its end date instead.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.routines, a.id) },
  get_metrics: { desc: 'All tracked metrics with their full series (bodyweight, lifts, applications sent, savings, ...).', args: {}, run: (db) => db.metrics },
  upsert_metric: {
    desc: 'Create or edit a tracked metric.',
    args: { id: S, name: S, unit: S, area: AREA, target: N, targetDate: DATE, cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'asNeeded'], description: 'How often the check-in asks for it. asNeeded (the default) never asks.' } },
    write: true,
    run(db, a) {
      if (!a.id) need(a.name, 'name')
      return metricSummary(upsert(db.metrics, 'mt', a, ['name', 'unit', 'area', 'target', 'targetDate', 'cadence'], { entries: [] }))
    }
  },
  log_metric: {
    desc: 'Record a metric reading for a date (replaces that date\'s reading). id may be the metric id or its name.',
    args: { id: S, date: DATE, value: N },
    required: ['id', 'value'],
    write: true,
    run: (db, a) => metricSummary(logMetric(db, a.id, dateArg(a.date), a.value))
  },
  delete_metric: { desc: 'Delete a metric and its series.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.metrics, a.id) },
  upsert_phase: {
    desc: 'Create or edit a life chapter on the arc from now until the end: a span of years with a title and theme.',
    args: { id: S, title: S, startYear: N, endYear: N, theme: S, detail: S },
    write: true,
    run(db, a) {
      if (!a.id) {
        need(a.title, 'title')
        need(a.startYear, 'startYear')
        need(a.endYear, 'endYear')
      }
      return upsert(db.phases, 'ph', a, ['title', 'startYear', 'endYear', 'theme', 'detail'])
    }
  },
  delete_phase: { desc: 'Delete a life chapter.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.phases, a.id) },
  update_profile: {
    desc: 'Edit the profile: name, birthDate (YYYY-MM-DD), lifeExpectancy in years (sets where the life arc ends), and free-form notes.',
    args: { name: S, birthDate: S, lifeExpectancy: N, notes: S },
    write: true,
    run(db, a) {
      if (a.birthDate && !isDate(a.birthDate)) throw new Error('birthDate must be YYYY-MM-DD')
      Object.assign(db.profile, pick(a, ['name', 'birthDate', 'lifeExpectancy', 'notes']))
      return db.profile
    }
  },
  upsert_area: {
    desc: 'Create or edit a life area. color is one of red, yellow, green, blue, purple, teal, orange, grey.',
    args: { id: S, name: S, color: S, summary: { type: 'string', description: 'Where this area stands: a few paragraphs shown at the top of its history.' } },
    required: ['id', 'name'],
    write: true,
    run(db, a) {
      let row = db.areas.find((x) => x.id === a.id)
      if (!row) db.areas.push((row = { id: a.id }))
      return Object.assign(row, pick(a, ['name', 'color', 'summary']))
    }
  },
  set_slot: {
    desc: 'Put an item at a time on a day, and optionally set how long it takes there. start is "HH:MM" (24-hour) or null to unschedule. For a task, minutes becomes its estimate; for a routine, minutes applies to that day only. To set a routine\'s usual time every day, use upsert_routine with startTime.',
    args: { date: DATE, key: { type: 'string', description: '"t:<id>" or "r:<id>" from get_day' }, start: { type: ['string', 'null'] }, minutes: N },
    required: ['key'],
    write: true,
    run(db, a) {
      const date = dateArg(a.date)
      const plan = dayPlan(db, date)
      if (!plan.items.some((it) => it.key === a.key)) throw new Error(`"${a.key}" is not on ${date}`)
      if (a.start != null && !isTime(a.start)) throw new Error('start must be HH:MM, 24-hour')
      if (a.minutes != null && !(a.minutes >= 5 && a.minutes <= 960)) throw new Error('minutes must be 5 to 960')
      const day = dayOf(db, date)
      day.slots ||= {}
      const isTask = a.key.startsWith('t:')
      if (a.start !== undefined) {
        if (a.start === null) {
          // A routine with a usual time is unscheduled for this day only; anything else just loses its slot.
          const r = !isTask && db.routines.find((x) => 'r:' + x.id === a.key)
          const rest = { ...(day.slots[a.key] || {}) }
          delete rest.start
          if (r?.startTime) day.slots[a.key] = { ...rest, start: '' }
          else if (Object.keys(rest).length) day.slots[a.key] = rest
          else delete day.slots[a.key]
        } else day.slots[a.key] = { ...(day.slots[a.key] || {}), start: a.start }
      }
      if (a.minutes != null) {
        if (isTask) {
          const t = db.tasks.find((x) => 't:' + x.id === a.key)
          t.estimate = Math.round(a.minutes)
        } else day.slots[a.key] = { ...(day.slots[a.key] || {}), minutes: Math.round(a.minutes) }
      }
      return dayPlan(db, date).items.find((it) => it.key === a.key)
    }
  },
  delete_reading: {
    desc: 'Remove one dated reading from a metric.',
    args: { id: S, date: DATE },
    required: ['id', 'date'],
    write: true,
    run(db, a) {
      const m = db.metrics.find((x) => x.id === a.id)
      if (!m) throw new Error(`No metric ${a.id}`)
      const before = (m.entries || []).length
      m.entries = (m.entries || []).filter((e) => e.date !== a.date)
      if (m.entries.length === before) throw new Error(`No reading on ${a.date}`)
      return { id: m.id, entries: m.entries.length }
    }
  },
  move_task: {
    desc: 'Move a task to another day (its do date). If the new day is after its end date, the end moves with it, but never past the end of the goal it serves; that move is refused. Claude cannot move a task onto a day that is full.',
    args: { ref: { type: 'string', description: '"t:<id>" or the bare id' }, date: S, start: { type: ['string', 'null'], description: 'Time on the new day, HH:MM; omit to keep its time, null to unschedule.' } },
    required: ['ref', 'date'],
    write: true,
    run(db, a, ctx) {
      const f = findItem(db, a.ref.startsWith('t:') ? a.ref : 't:' + a.ref)
      if (!f || f.kind !== 'task') throw new Error(`No task ${a.ref}`)
      const t = f.item
      if (CLOSED.has(t.status)) throw new Error('A closed task cannot be moved; reopen it first')
      const d = a.date
      if (!validDate(d)) throw new Error(`Bad date "${d}"`)
      const from = t.date
      if (!t.end || d > t.end) {
        const parent = db.goals.find((g) => g.id === t.goalId)
        const limit = parent ? itemEnd(db, parent, 'goal') : null
        if (limit && d > limit) {
          const e = new Error(`That is after the goal it serves ends (${limit}). Move it earlier, or change the goal first.`)
          e.code = 'WINDOW'
          throw e
        }
        t.end = d
      }
      t.date = d
      // It leaves the old day's focus and order.
      const old = db.days[from]
      const oldSlot = old?.slots?.[f.ref]
      if (old?.focus) old.focus = old.focus.filter((k) => k !== f.ref)
      if (old?.order) old.order = old.order.filter((k) => k !== f.ref)
      if (old?.slots) delete old.slots[f.ref]
      const start = a.start === undefined ? oldSlot?.start : a.start
      if (start != null && start !== '') {
        if (!isTime(start)) throw new Error('start must be HH:MM, 24-hour')
        const nd = dayOf(db, d)
        nd.slots ||= {}
        nd.slots[f.ref] = { start }
      }
      if (ctx.actor === 'claude') checkCapacity(db, t)
      return { ref: f.ref, from, date: t.date, end: t.end, start: db.days[d]?.slots?.[f.ref]?.start || null }
    }
  },
  reorder_day: {
    desc: "Set the order of a day's items (keys from get_day, first to last).",
    args: { date: DATE, keys: { type: 'array', items: S } },
    required: ['keys'],
    write: true,
    run(db, a) {
      const date = dateArg(a.date)
      const keys = new Set(dayPlan(db, date).items.map((it) => it.key))
      dayOf(db, date).order = [...new Set(a.keys)].filter((k) => keys.has(k))
      return { date, order: db.days[date].order }
    }
  },
  set_focus: {
    desc: 'Choose up to three focus items for a day: the things that make the day a success. keys come from get_day (e.g. "t:tk_ab12" or "r:rt_cd34"); titles also work. An empty list goes back to the suggested focus.',
    args: { date: DATE, keys: { type: 'array', items: S, maxItems: 3 } },
    required: ['keys'],
    write: true,
    run(db, a, ctx) {
      const date = dateArg(a.date)
      const plan = dayPlan(db, date)
      const keys = a.keys.map((k) => plan.items.find((it) => it.key === k || it.title.toLowerCase() === String(k).toLowerCase())?.key || k)
      for (const k of keys) if (!plan.items.some((it) => it.key === k)) throw new Error(`"${k}" is not on ${date}`)
      if (new Set(keys).size > 3) throw new Error('At most three focus items')
      const day = dayOf(db, date)
      day.focus = [...new Set(keys)]
      day.focusBy = ctx.actor
      if (!day.focus.length) delete day.focus
      return { date, focus: focusFor(db, date) }
    }
  },
  balance_days: {
    desc: 'Find days over capacity in a range and the moves that would fix them: could-priority tasks first, then should, each to the next day with room before its end date. Must tasks and focus items never move. Read-only: show the plan to the user, or propose the moves with propose_changes; the user applies it from the dashboard.',
    args: { from: DATE, to: DATE },
    run(db, a) {
      const from = dateArg(a.from)
      const to = a.to ? dateArg(a.to) : addDays(from, 13)
      return { from, to, ...balance(JSON.parse(JSON.stringify(db)), from, to) }
    }
  },
  apply_balance: {
    desc: 'Apply the balancing plan for a range. Dashboard only.',
    userOnly: true,
    args: { from: DATE, to: DATE },
    write: true,
    note: (a) => `Balanced days from ${a.from || 'today'}${a.to ? ` to ${a.to}` : ''}`,
    run(db, a) {
      const from = dateArg(a.from)
      const to = a.to ? dateArg(a.to) : addDays(from, 13)
      return { from, to, ...balance(db, from, to) }
    }
  },
  set_capacity: {
    desc: 'Minutes available for planned items on each weekday (Sunday first). Dashboard only.',
    userOnly: true,
    args: { minutes: { type: 'array', items: N, minItems: 7, maxItems: 7 } },
    required: ['minutes'],
    write: true,
    run(db, a) {
      if (a.minutes.length !== 7 || a.minutes.some((m) => !(m >= 0 && m <= 1440))) throw new Error('Give seven numbers of minutes, 0 to 1440, Sunday first')
      db.policy ||= DEFAULT_POLICY()
      db.policy.capacity = { minutes: a.minutes.map((m) => Math.round(m)) }
      return db.policy.capacity
    }
  },
  decide: {
    desc: "Record the user's decision on a Decision item: the option chosen (index or text) and their reasons. Adds it to the history and closes the item if its other criteria are met. Only record what the user actually decided.",
    args: { ref: S, option: { type: ['number', 'string'], description: 'Option index (0-based) or its text.' }, reasons: S },
    required: ['ref', 'option'],
    write: true,
    run(db, a, ctx) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      const d = (f.item.decision ||= { question: f.item.title, options: [] })
      let i = typeof a.option === 'number' ? a.option : d.options.findIndex((o) => o.text.toLowerCase() === String(a.option).toLowerCase())
      if (i < 0 && typeof a.option === 'string' && a.option.trim()) {
        d.options.push({ text: a.option.trim(), notes: '' })
        i = d.options.length - 1
      }
      if (!(i >= 0 && i < d.options.length)) throw new Error('That option is not on the list')
      Object.assign(d, { chosen: i, chosenAt: today(), reasons: a.reasons || d.reasons })
      if (f.item.type !== 'decision') f.item.type = 'decision'
      db.facts.push({ id: id('fx'), date: today(), area: f.item.area, title: `Decided: ${d.question || f.item.title}`, detail: `Chose "${d.options[i].text}".${a.reasons ? ' ' + a.reasons : ''}`, kind: 'decision', source: f.ref, origin: ctx.actor === 'claude' ? 'claude' : 'you', createdAt: new Date().toISOString() })
      let closed = true
      try {
        closeItem(db, f.kind, f.item, { status: 'done', outcome: `Chose "${d.options[i].text}"` }, ctx.actor)
      } catch (e) {
        if (e.code !== 'CRITERIA') throw e
        closed = false
      }
      return { ...describeItem(db, f), closedNow: closed }
    }
  },
  list_facts: {
    desc: 'The history: dated facts about the user\'s life (events, decisions, readings, statements, purchases, ideas). Filter by date range, area or text. Read this for background before planning.',
    args: { from: DATE, to: DATE, area: AREA, q: { type: 'string', description: 'Text to search for' }, limit: N },
    run(db, a) {
      const q = (a.q || '').toLowerCase()
      const out = db.facts.filter((f) => (!a.from || f.date >= a.from) && (!a.to || f.date <= a.to) && (!a.area || f.area === a.area) && (!q || `${f.title} ${f.detail || ''}`.toLowerCase().includes(q)))
      out.sort((x, y) => y.date.localeCompare(x.date))
      return out.slice(0, a.limit || 200)
    }
  },
  add_fact: {
    desc: 'Record something that happened or was decided, so the history stays true: an event, a decision, a purchase, a statement worth keeping. Use it when the user tells you something about their life that is not a target or a metric reading. Pass id to edit.',
    args: { id: S, date: DATE, area: AREA, title: S, detail: S, kind: { type: 'string', enum: ['event', 'decision', 'reading', 'plan', 'idea', 'pattern', 'purchase', 'statement'] }, source: { type: 'string', description: 'Where this came from: "check-in 2026-11-21", a conversation date, a document.' } },
    write: true,
    run(db, a, ctx) {
      if (!a.id) {
        need(a.title, 'title')
        a.date = dateArg(a.date)
        a.area ||= 'life'
        a.kind ||= 'event'
        a.origin = ctx.actor === 'claude' ? 'claude' : 'you'
        a.createdAt = new Date().toISOString()
      }
      return upsert(db.facts, 'fx', a, ['date', 'area', 'title', 'detail', 'kind', 'source', 'origin', 'createdAt'])
    }
  },
  propose_changes: {
    desc: 'Propose changes to existing goals, tasks and routines for the user to review in the Inbox: "update" with the fields to set (goals and tasks: type, title, why, requirements, noRequirements, proposal, criteria, decision, start, end, estimate, priority, parentId, goalId, date, area, target, detail; routines, ref "r:<id>": title, target, estimate, criterion, days, start, end, active, goalId, area, time, detail), or "drop" with a reason (a dropped routine is ended). Nothing changes until the user accepts. A new proposal for the same item replaces the pending one. Use this to restructure or re-plan items rather than editing them directly.',
    args: {
      changes: {
        type: 'array',
        items: { type: 'object', properties: { ref: { type: 'string', description: '"g:<id>" or "t:<id>"' }, action: { type: 'string', enum: ['update', 'drop'] }, fields: { type: 'object' }, reason: { type: 'string', description: 'One line: what changes and why.' } }, required: ['ref', 'action', 'reason'] }
      },
      batch: { type: 'string', description: 'A label grouping these proposals, e.g. "restructure-2026-11".' },
      source: S
    },
    required: ['changes'],
    write: true,
    note: (a) => `Proposed ${a.changes.length} change${a.changes.length === 1 ? '' : 's'} for review${a.batch ? ` (${a.batch})` : ''}`,
    run(db, a, ctx) {
      const out = []
      for (const c of a.changes) out.push(proposeChange(db, c, ctx.actor, a.batch, a.source).id)
      return { proposed: out.length, pending: db.proposals.length }
    }
  },
  list_proposals: {
    desc: 'What is waiting in the user\'s Inbox: proposed changes to existing items (with before and after) and new items still marked proposed.',
    args: { area: AREA, batch: S, limit: N },
    run(db, a) {
      const changes = db.proposals.filter((p) => (!a.area || p.area === a.area) && (!a.batch || p.batch === a.batch))
      const newItems = [...db.goals.map((g) => ['goal', g]), ...db.tasks.map((t) => ['task', t])].filter(([, x]) => x.status === 'proposed' && (!a.area || x.area === a.area))
      return {
        counts: { changes: changes.length, newItems: newItems.length },
        changes: changes.slice(0, a.limit || 50).map((p) => ({ ...p, before: pick(findAny(db, p.ref)?.item || {}, Object.keys(p.fields || {})) })),
        newItems: newItems.slice(0, a.limit || 50).map(([kind, x]) => ({ ref: (kind === 'goal' ? 'g:' : 't:') + x.id, kind, title: x.title, area: x.area, quality: quality(lint(db, x, kind)) }))
      }
    }
  },
  review_proposals: {
    desc: 'Accept or reject proposals. Dashboard only: the user decides.',
    userOnly: true,
    args: { ids: { type: 'array', items: S }, refs: { type: 'array', items: S, description: 'New items (status proposed) to accept or reject.' }, decision: { type: 'string', enum: ['accept', 'reject'] } },
    required: ['decision'],
    write: true,
    note: (a) => `${a.decision === 'accept' ? 'Accepted' : 'Rejected'} ${(a.ids || []).length + (a.refs || []).length} proposal${(a.ids || []).length + (a.refs || []).length === 1 ? '' : 's'}`,
    run(db, a, ctx) {
      const done = []
      const failed = []
      for (const pid of a.ids || []) {
        const p = db.proposals.find((x) => x.id === pid)
        if (!p) continue
        try {
          if (a.decision === 'accept') applyProposal(db, p, ctx.actor)
          db.proposals = db.proposals.filter((x) => x.id !== pid)
          done.push(p.ref)
        } catch (e) {
          failed.push({ ref: p.ref, error: String(e.message || e) })
        }
      }
      for (const ref of a.refs || []) {
        const f = findItem(db, ref)
        if (!f || f.item.status !== 'proposed') continue
        if (a.decision === 'accept') f.item.status = 'active'
        else {
          const list = f.kind === 'goal' ? db.goals : db.tasks
          list.splice(list.indexOf(f.item), 1)
          db.proposals = db.proposals.filter((x) => x.ref !== f.ref)
        }
        done.push(f.ref)
      }
      return { decision: a.decision, done: done.length, failed }
    }
  },
  withdraw_proposals: {
    desc: 'Withdraw pending change proposals (by id, by item ref, or a whole batch) without applying them.',
    args: { ids: { type: 'array', items: S }, refs: { type: 'array', items: S }, batch: S },
    write: true,
    run(db, a) {
      const before = db.proposals.length
      db.proposals = db.proposals.filter((p) => !((a.ids || []).includes(p.id) || (a.refs || []).includes(p.ref) || (a.batch && p.batch === a.batch)))
      return { withdrawn: before - db.proposals.length }
    }
  },
  list_overdue: {
    desc: 'Goals and tasks past their target end date and not closed (missed), plus items blocked by a requirement. Triage each with triage.',
    args: { date: DATE },
    run: (db, a) => overdue(db, dateArg(a.date))
  },
  triage: {
    desc: 'Decide what happens to a missed or blocked item: "move" (a task to a new do date, and end if later; a goal to a new end inside its period), "drop" (with a reason), "done" (criteria must be met, or give overrideReason), or "routine" (turn a task into a recurring routine and drop the one-off).',
    args: { ref: S, action: { type: 'string', enum: ['move', 'drop', 'done', 'routine'] }, date: { type: 'string', description: 'move: the new do date (tasks) or end date (goals).' }, end: DATE, reason: S, overrideReason: S, days: { type: 'array', items: N, description: 'routine: weekdays 0-6, 0 = Sunday.' }, repeat: REPEAT },
    required: ['ref', 'action'],
    write: true,
    run(db, a, ctx) {
      const f = findItem(db, a.ref)
      if (!f) throw new Error(`No item ${a.ref}`)
      const { item, kind } = f
      if (a.action === 'move') {
        const d = need(a.date, 'date')
        if (!validDate(d)) throw new Error(`Bad date "${d}"`)
        if (kind === 'task') {
          item.date = d
          item.end = a.end && validDate(a.end) ? a.end : item.end && item.end >= d ? item.end : d
          if (ctx.actor === 'claude') checkCapacity(db, item)
        } else {
          const pe = periodEnd(db, item.horizon, item.period)
          if (d > pe) throw new Error(`A ${item.horizon} goal cannot end after its period (${pe}). Drop it and set a goal in a later period instead.`)
          item.end = d
        }
        if (item.status === 'proposed') item.status = 'active'
      } else if (a.action === 'drop') closeItem(db, kind, item, { status: 'dropped', outcome: a.reason || 'Dropped in triage' }, ctx.actor)
      else if (a.action === 'done') closeItem(db, kind, item, { status: 'done', overrideReason: a.overrideReason, outcome: a.reason }, ctx.actor)
      else if (a.action === 'routine') {
        if (kind !== 'task') throw new Error('Only a task can become a routine')
        const r = { id: id('rt'), title: item.title, area: item.area, target: item.target || '', criterion: (item.criteria || [])[0]?.text || '', detail: item.detail || '', days: Array.isArray(a.days) && a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6], start: item.date && item.date > today() ? item.date : today(), active: true, goalId: item.goalId || null, estimate: item.estimate, repeat: a.repeat ? checkRepeat(a.repeat) : undefined }
        const slot = db.days[item.date]?.slots?.['t:' + item.id]
        if (slot?.start) r.startTime = slot.start
        if (a.repeat) r.start = item.date || today()
        db.routines.push(r)
        closeItem(db, kind, item, { status: 'dropped', outcome: `Turned into the routine "${r.title}"` }, ctx.actor)
      } else throw new Error('action must be move, drop, done or routine')
      return describeItem(db, f)
    }
  },
  delete_fact: { desc: 'Remove a history entry.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.facts, a.id) },
  log_revision: {
    desc: 'Explain a change of plan in the revision log: what changed and the evidence for it. Call this after re-planning so the reasoning is on record.',
    args: { summary: S },
    required: ['summary'],
    write: true,
    note: (a) => a.summary,
    run: () => ({ ok: true })
  },
  get_revisions: { desc: 'The revision log, newest last.', args: { limit: N }, run: (db, a) => db.revisions.slice(-(a.limit || 30)) }
}

function checkRepeat(x) {
  if (x == null || x === '') return undefined
  if (!REPEAT_UNITS.includes(x.every)) throw new Error('repeat.every must be day, week, month or year')
  const interval = x.interval == null ? 1 : Math.round(+x.interval)
  if (!(interval >= 1 && interval <= 99)) throw new Error('repeat.interval must be 1 to 99')
  return { every: x.every, interval }
}

function logMetric(db, ref, date, value) {
  const m = db.metrics.find((x) => x.id === ref) || db.metrics.find((x) => x.name.toLowerCase() === String(ref).toLowerCase())
  if (!m) throw new Error(`No metric "${ref}". Create it with upsert_metric first.`)
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('value must be a number')
  m.entries = (m.entries || []).filter((e) => e.date !== date)
  m.entries.push({ date, value })
  m.entries.sort((a, b) => a.date.localeCompare(b.date))
  return m
}

const QUIET = new Set(['set_item_status', 'reorder_day', 'set_slot']) // too frequent to be worth a revision entry

/** Text of every string inside a value, for the exclusion check. */
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Refuses writes from Claude that touch a topic the user excluded. */
export function checkPolicy(db, args) {
  const terms = db.policy?.excluded || []
  if (!terms.length) return
  const text = strings(args).join('\n')
  for (const t of terms) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)) {
      const e = new Error(`Refused: this mentions "${t}", a topic the user has excluded from the plan (Settings, Excluded topics). Leave it out.`)
      e.code = 'POLICY'
      throw e
    }
  }
}

/**
 * Runs one operation. actor is "you" (dashboard) or "claude" (MCP). basedOnRev, when given, must equal the revision
 * on disk, or the write is refused so nobody overwrites a change they have not seen.
 */
export function run(name, args = {}, actor = 'you', { basedOnRev } = {}) {
  const op = OPS[name]
  if (!op) throw new Error(`Unknown operation "${name}"`)
  if (op.userOnly && actor !== 'you') throw new Error(`"${name}" can only be used from the dashboard`)
  for (const r of op.required || []) need(args[r], r)
  const db = load()
  if (op.write && basedOnRev != null && +basedOnRev !== db.rev) throw new StaleError(db.rev)
  if (op.write && actor === 'claude') checkPolicy(db, args)
  const result = op.run(db, args, { actor })
  if (op.write) {
    if (!QUIET.has(name)) {
      const what = op.note ? op.note(args) : `${name.replace(/_/g, ' ')}${args.title || args.name ? `: ${args.title || args.name}` : args.date ? ` (${args.date})` : args.id ? ` (${args.id})` : ''}`
      db.revisions.push({ at: new Date().toISOString(), actor, summary: what })
      if (db.revisions.length > 1000) db.revisions.splice(0, db.revisions.length - 1000)
    }
    save(db)
  }
  return result
}

export { score }
