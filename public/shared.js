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

// ---- repeating ---------------------------------------------------------------------------------------------------
// A routine repeats by r.repeat = { every: 'day' | 'week' | 'month' | 'year', interval: n }, counted from r.start.
// Weekly ones use r.days (weekdays, 0 = Sunday). Monthly ones land on the start's day of the month (the last day in
// shorter months), yearly ones on its month and day. No repeat means weekly on r.days, as before.
export const REPEAT_UNITS = ['day', 'week', 'month', 'year']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export function repeatOf(r) {
  const every = REPEAT_UNITS.includes(r.repeat?.every) ? r.repeat.every : 'week'
  return { every, interval: Math.max(1, Math.round(+r.repeat?.interval || 1)) }
}
export function repeatsOn(r, date) {
  const { every, interval: n } = repeatOf(r)
  const anchor = r.start || date
  if (date < anchor) return false
  const d = parse(date)
  const a = parse(anchor)
  if (every === 'day') return daysBetween(anchor, date) % n === 0
  if (every === 'week') return (r.days || ALL_DAYS).includes(d.getDay()) && (daysBetween(weekStart(anchor), weekStart(date)) / 7) % n === 0
  const months = (d.getFullYear() - a.getFullYear()) * 12 + d.getMonth() - a.getMonth()
  const onDay = d.getDate() === Math.min(a.getDate(), daysInMonth(d.getFullYear(), d.getMonth() + 1))
  if (every === 'month') return onDay && months % n === 0
  return onDay && d.getMonth() === a.getMonth() && (months / 12) % n === 0
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th')
/** Plain words for a routine's repeat, e.g. "Every 2 weeks on Monday, Thursday". */
export function repeatLabel(r) {
  const { every, interval: n } = repeatOf(r)
  const each = n === 1 ? `Every ${every}` : `Every ${n} ${every}s`
  const a = parse(r.start || today())
  if (every === 'day') return n === 1 ? 'Every day' : each
  if (every === 'month') return `${each} on the ${ordinal(a.getDate())}`
  if (every === 'year') return `${each} on ${MONTH_NAMES[a.getMonth()]} ${a.getDate()}`
  const days = r.days || ALL_DAYS
  if (days.length === 7) return n === 1 ? 'Every day' : `${each}, every day`
  if (days.length === 5 && ![0, 6].some((x) => days.includes(x))) return n === 1 ? 'Every weekday' : `${each} on weekdays`
  return `${each} on ${[1, 2, 3, 4, 5, 6, 0].filter((x) => days.includes(x)).map((x) => DAY_NAMES[x]).join(', ')}`
}

// ---- health measures a metric can be filled from (the Garmin watch, via the Garmin Sync app) ----------------------
// name is the metric created for it when there is none yet. Sleep, waking and falling asleep are dated by the
// morning you woke up; times are hours (7.5 = 7:30), falling asleep counted from midnight (23:30 = -0.5).
export const HEALTH_SOURCES = {
  'garmin.resting_hr': { label: 'Resting heart rate', name: 'Resting heart rate, Garmin', unit: 'bpm' },
  'garmin.steps': { label: 'Steps', name: 'Steps', unit: 'steps' },
  'garmin.sleep_hours': { label: 'Sleep, hours asleep', name: 'Sleep', unit: 'h/night' },
  'garmin.sleep_onset': { label: 'Fell asleep, hours after midnight', name: 'Fell asleep, hour of the morning', unit: 'h' },
  'garmin.wake': { label: 'Woke up, hour of day', name: 'Wake time, hour of day', unit: 'h' },
  'garmin.hrv': { label: 'HRV, nightly average', name: 'HRV, nightly average', unit: 'ms' },
  'garmin.stress': { label: 'Stress, daily average', name: 'Stress, daily average', unit: '' },
  'garmin.body_battery': { label: 'Body battery, daily high', name: 'Body battery, daily high', unit: '' }
}

const routineApplies = (r, date) => r.active !== false && (!r.start || date >= r.start) && (!r.end || date <= r.end) && repeatsOn(r, date)

/** The targets for one day: scheduled routines plus one-off tasks, with what was recorded against them. */
/**
 * Joins two edits of one journal entry made from the same starting text, so neither is lost: the dashboard's
 * (mine) and one that landed meanwhile (theirs), usually Claude adding to the end. Additions at the end are kept in
 * order; anything else keeps both versions.
 */
export function mergeJournal(base, mine, theirs) {
  base = base || ''
  if (theirs === base || theirs === mine) return mine
  if (mine === base) return theirs
  if (theirs.startsWith(base)) return mine.replace(/\s*$/, '') + (mine.trim() ? '\n\n' : '') + theirs.slice(base.length).replace(/^\s+/, '')
  if (mine.startsWith(base)) return theirs.replace(/\s*$/, '') + (theirs.trim() ? '\n\n' : '') + mine.slice(base.length).replace(/^\s+/, '')
  return mine.replace(/\s*$/, '') + '\n\n' + theirs
}

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
  // A day the user has reordered keeps that order; items not in it follow, in the default order.
  if (day.order?.length) {
    const pos = new Map(day.order.map((k, i) => [k, i]))
    const base = new Map(items.map((it, i) => [it.key, i]))
    items.sort((a, b) => (pos.get(a.key) ?? 1e6 + base.get(a.key)) - (pos.get(b.key) ?? 1e6 + base.get(b.key)))
  }
  for (const it of items) {
    const slot = (day.slots || {})[it.key]
    const r = it.kind === 'routine' ? db.routines.find((x) => 'r:' + x.id === it.key) : null
    it.start = slot?.start ?? (slot === null ? '' : r?.startTime || '')
    if (slot?.minutes != null) it.slotMinutes = slot.minutes
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
