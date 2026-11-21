// The plan store and every operation on it. The dashboard (POST /api/op) and the MCP tools call the same table.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { today, addDays, dayPlan, score, goalsFor, periodsFor, ageOn, daysBetween, HORIZONS } from '../public/shared.js'

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
  revisions: []
})

export function load() {
  if (!existsSync(FILE)) return EMPTY()
  return { ...EMPTY(), ...JSON.parse(readFileSync(FILE, 'utf8')) }
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

// ---- operations --------------------------------------------------------------------------------------------------
// Each: { desc, args (JSON-schema properties), required, write, run(db, args) -> result }. `write` ops are saved and
// recorded in the revision log with the actor (you in the dashboard, or Claude over MCP).

const S = { type: 'string' }
const N = { type: 'number' }
const DATE = { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' }
const AREA = { type: 'string', description: 'Area id (see get_overview.areas), e.g. health, career, learning.' }

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
        goals: Object.fromEntries(HORIZONS.map((h) => [h, goalsFor(db, h, p[h]).filter((g) => g.status !== 'dropped')])),
        periods: p,
        last7: { overall: last7.overall, days: last7.days, daysWithoutCheckIn: last7.days.filter((d) => !d.checkedIn).map((d) => d.date) },
        streakDays: streak(db, date),
        metrics: db.metrics.map(metricSummary),
        routines: db.routines,
        phases: db.phases,
        recentRevisions: db.revisions.slice(-5)
      }
    }
  },
  get_day: {
    desc: 'One day\'s targets (routines plus one-off tasks) with status, actuals, the brief and the check-in.',
    args: { date: DATE },
    run: (db, a) => dayPlan(db, dateArg(a.date))
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
        const k = (goals[g.horizon] ||= { active: 0, done: 0, dropped: 0 })
        k[g.status || 'active'] = (k[g.status || 'active'] || 0) + 1
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
    run(db, a) {
      const date = dateArg(a.date)
      setCheck(db, date, need(a.key, 'key'), a)
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
    run(db, a) {
      const date = dateArg(a.date)
      const day = dayOf(db, date)
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
          const t = { id: id('tk'), date, title: it.title, area: it.area || 'life', unplanned: true }
          db.tasks.push(t)
          key = 't:' + t.id
          unmatched.push(it.title)
        }
        setCheck(db, date, key, { status: 'done', ...it })
      }
      for (const m of a.metrics || []) logMetric(db, m.id, date, m.value)
      return { ...dayPlan(db, date), addedAsUnplanned: unmatched }
    }
  },
  plan_day: {
    desc: 'Set a day\'s plan: a short brief shown at the top of the day, one-off tasks to add, and routines to hide for that day (rest day, travel, illness). replace=true first removes the day\'s existing one-off tasks that have no recorded result.',
    args: {
      date: DATE,
      brief: { type: 'string', description: 'Two or three sentences: the focus for the day and why.' },
      tasks: { type: 'array', items: { type: 'object', properties: { title: S, area: AREA, target: S, detail: S, goalId: S, time: { type: 'string', enum: ['am', '', 'pm'] } }, required: ['title', 'area'] } },
      hideRoutines: { type: 'array', items: S, description: 'Routine ids to leave out of this day.' },
      replace: { type: 'boolean' }
    },
    write: true,
    run(db, a) {
      const date = dateArg(a.date)
      const day = dayOf(db, date)
      if (a.brief !== undefined) day.brief = a.brief
      if (a.replace) db.tasks = db.tasks.filter((t) => t.date !== date || (day.checks || {})['t:' + t.id])
      for (const t of a.tasks || []) db.tasks.push({ id: id('tk'), date, ...pick(t, ['title', 'area', 'target', 'detail', 'goalId', 'time']) })
      if (a.hideRoutines) day.hidden = a.hideRoutines.map((r) => (r.startsWith('r:') ? r : 'r:' + r))
      return dayPlan(db, date)
    }
  },
  upsert_task: {
    desc: 'Add a one-off target to a day, or edit one (pass id). Moving it is editing its date.',
    args: { id: S, date: DATE, title: S, area: AREA, target: S, detail: S, goalId: S, time: { type: 'string', enum: ['am', '', 'pm'] } },
    write: true,
    run(db, a) {
      if (!a.id) {
        need(a.title, 'title')
        a.date = dateArg(a.date)
        a.area ||= 'life'
      }
      return upsert(db.tasks, 'tk', a, ['date', 'title', 'area', 'target', 'detail', 'goalId', 'time'])
    }
  },
  delete_task: { desc: 'Remove a one-off target.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.tasks, a.id) },
  list_goals: {
    desc: 'Goals, optionally filtered. horizon is week | month | year | decade | life. period is "2026-W47", "2026-11", "2026", "2020" (the 2020s) or "life".',
    args: { horizon: { type: 'string', enum: HORIZONS }, period: S, area: AREA, status: { type: 'string', enum: ['active', 'done', 'dropped'] } },
    run: (db, a) => db.goals.filter((g) => (!a.horizon || g.horizon === a.horizon) && (!a.period || g.period === a.period) && (!a.area || g.area === a.area) && (!a.status || (g.status || 'active') === a.status))
  },
  upsert_goal: {
    desc: 'Create a goal, or edit one (pass id). Link it upward with parentId so each week goal traces to a month, year, decade and life goal. progress is 0-100.',
    args: { id: S, horizon: { type: 'string', enum: HORIZONS }, period: { type: 'string', description: '"2026-W47" | "2026-11" | "2026" | "2020" | "life"' }, area: AREA, title: S, detail: S, measure: { type: 'string', description: 'How done is judged, e.g. "bodyweight 185 lb by Dec 31".' }, progress: N, status: { type: 'string', enum: ['active', 'done', 'dropped'] }, parentId: S, metricId: S },
    write: true,
    run(db, a) {
      if (!a.id) {
        need(a.title, 'title')
        need(a.horizon, 'horizon')
        if (!HORIZONS.includes(a.horizon)) throw new Error(`horizon must be one of ${HORIZONS.join(', ')}`)
        a.period = a.horizon === 'life' ? 'life' : need(a.period, 'period')
        a.area ||= 'life'
      }
      return upsert(db.goals, 'gl', a, ['horizon', 'period', 'area', 'title', 'detail', 'measure', 'progress', 'status', 'parentId', 'metricId'], { status: 'active', progress: 0 })
    }
  },
  delete_goal: { desc: 'Delete a goal. Prefer status "dropped" to keep the history.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.goals, a.id) },
  list_routines: { desc: 'Recurring targets that populate each day automatically.', args: {}, run: (db) => db.routines },
  upsert_routine: {
    desc: 'Create or edit a recurring target. days are weekday numbers 0-6 with 0 = Sunday (omit for every day). start/end bound the dates it applies to; set active=false to pause it. To change a programme (e.g. new training block), end the old routine and start a new one so history stays true.',
    args: { id: S, title: S, area: AREA, target: { type: 'string', description: 'The measurable target, e.g. "45 min zone 2" or "5 applications".' }, detail: S, days: { type: 'array', items: N }, start: DATE, end: DATE, active: { type: 'boolean' }, goalId: S, time: { type: 'string', enum: ['am', '', 'pm'] } },
    write: true,
    run(db, a) {
      if (!a.id) {
        need(a.title, 'title')
        a.area ||= 'life'
        a.start ||= today()
      }
      return upsert(db.routines, 'rt', a, ['title', 'area', 'target', 'detail', 'days', 'start', 'end', 'active', 'goalId', 'time'], { active: true })
    }
  },
  delete_routine: { desc: 'Delete a routine and its place in past days. To stop one going forward, set its end date instead.', args: { id: S }, required: ['id'], write: true, run: (db, a) => remove(db.routines, a.id) },
  get_metrics: { desc: 'All tracked metrics with their full series (bodyweight, lifts, applications sent, savings, ...).', args: {}, run: (db) => db.metrics },
  upsert_metric: {
    desc: 'Create or edit a tracked metric.',
    args: { id: S, name: S, unit: S, area: AREA, target: N, targetDate: DATE },
    write: true,
    run(db, a) {
      if (!a.id) need(a.name, 'name')
      return metricSummary(upsert(db.metrics, 'mt', a, ['name', 'unit', 'area', 'target', 'targetDate'], { entries: [] }))
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
    args: { id: S, name: S, color: S },
    required: ['id', 'name'],
    write: true,
    run(db, a) {
      let row = db.areas.find((x) => x.id === a.id)
      if (!row) db.areas.push((row = { id: a.id }))
      return Object.assign(row, pick(a, ['name', 'color']))
    }
  },
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

function logMetric(db, ref, date, value) {
  const m = db.metrics.find((x) => x.id === ref) || db.metrics.find((x) => x.name.toLowerCase() === String(ref).toLowerCase())
  if (!m) throw new Error(`No metric "${ref}". Create it with upsert_metric first.`)
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('value must be a number')
  m.entries = (m.entries || []).filter((e) => e.date !== date)
  m.entries.push({ date, value })
  m.entries.sort((a, b) => a.date.localeCompare(b.date))
  return m
}

const QUIET = new Set(['set_item_status']) // too frequent to be worth a revision entry

export function run(name, args = {}, actor = 'you') {
  const op = OPS[name]
  if (!op) throw new Error(`Unknown operation "${name}"`)
  for (const r of op.required || []) need(args[r], r)
  const db = load()
  const result = op.run(db, args)
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
