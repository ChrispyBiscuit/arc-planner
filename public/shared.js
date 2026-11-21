// Date helpers and plan logic shared by the server (Node) and the dashboard (browser).
// Dates are local calendar days written as 'YYYY-MM-DD'.

export const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}
export const today = () => ymd(new Date())
export const addDays = (s, n) => {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const addMonths = (s, n) => {
  const d = parse(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return ymd(d)
}
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5)
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate()

export function isoWeek(s) {
  const d = parse(s)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7)
  return { year, week, key: `${year}-W${pad(week)}` }
}
/** Monday of the week containing the date. */
export const weekStart = (s) => addDays(s, 1 - (parse(s).getDay() || 7))
export const weekDays = (s) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i))

export const decadeOf = (year) => Math.floor(year / 10) * 10
export function periodsFor(date) {
  const year = +date.slice(0, 4)
  return { week: isoWeek(date).key, month: date.slice(0, 7), year: String(year), decade: String(decadeOf(year)), life: 'life' }
}
export const HORIZONS = ['week', 'month', 'year', 'decade', 'life']

export function ageOn(birthDate, date) {
  if (!birthDate) return null
  const b = parse(birthDate)
  const d = parse(date)
  let age = d.getFullYear() - b.getFullYear()
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--
  return age
}

const routineApplies = (r, date) =>
  r.active !== false && (r.days || [0, 1, 2, 3, 4, 5, 6]).includes(parse(date).getDay()) && (!r.start || date >= r.start) && (!r.end || date <= r.end)

/** The targets for one day: scheduled routines plus one-off tasks, with what was recorded against them. */
export function dayPlan(db, date) {
  const day = db.days[date] || {}
  const hidden = new Set(day.hidden || [])
  const items = []
  for (const r of db.routines) {
    if (!routineApplies(r, date) || hidden.has('r:' + r.id)) continue
    items.push({ key: 'r:' + r.id, kind: 'routine', area: r.area, title: r.title, target: r.target || '', goalId: r.goalId || null, time: r.time || '', detail: r.detail || '', criterion: r.criterion || '' })
  }
  for (const t of db.tasks) {
    if (t.date !== date || t.status === 'dropped') continue
    items.push({ key: 't:' + t.id, kind: 'task', area: t.area, title: t.title, target: t.target || '', goalId: t.goalId || null, time: t.time || '', detail: t.detail || '', type: t.type || '', end: t.end || '', estimate: t.estimate || null, priority: t.priority || '', itemStatus: t.status || 'active', proposed: t.status === 'proposed' })
  }
  const order = { am: 0, '': 1, pm: 2 }
  items.sort((a, b) => (order[a.time] ?? 1) - (order[b.time] ?? 1))
  for (const it of items) {
    const c = (day.checks || {})[it.key] || {}
    it.status = c.status || (it.itemStatus === 'done' ? 'done' : 'todo')
    it.actual = c.actual ?? ''
    it.note = c.note || ''
  }
  return { date, brief: day.brief || '', checkin: day.checkin || null, items, score: score(items) }
}

/** Proposed items show on the day but never count toward the score until they are accepted. */
export function score(all) {
  const items = all.filter((it) => !it.proposed)
  const s = { total: items.length, done: 0, partial: 0, skipped: 0, todo: 0 }
  for (const it of items) s[it.status] = (s[it.status] || 0) + 1
  s.pct = s.total ? Math.round(((s.done + s.partial * 0.5) / s.total) * 100) : null
  return s
}

export const goalsFor = (db, horizon, period) => db.goals.filter((g) => g.horizon === horizon && g.period === period)

export function periodLabel(horizon, period) {
  if (horizon === 'life') return 'Life'
  if (horizon === 'decade') return `${period}s`
  if (horizon === 'year') return period
  if (horizon === 'month') return parse(period + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (horizon === 'week') return `Week ${+period.slice(6)}, ${period.slice(0, 4)}`
  return period
}
