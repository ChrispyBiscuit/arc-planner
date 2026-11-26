// Health: reads the Garmin Sync app running on this machine (a local web app that collects a Garmin watch's data
// over Bluetooth). Arc only reads it, over HTTP on 127.0.0.1; nothing from it is written into the plan.
//   ARC_GARMIN_URL   where Garmin Sync listens (default http://127.0.0.1:8765; must be on this machine)

import { ymd } from '../public/shared.js'

const DEFAULT = 'http://127.0.0.1:8765'
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
export const GARMIN_URL = (() => {
  const u = (process.env.ARC_GARMIN_URL || DEFAULT).replace(/\/+$/, '')
  return LOCAL.test(u) ? u : DEFAULT
})()

/** Calls Garmin Sync. Never throws: when it is not running the answer is { offline: true, error }. */
export async function garmin(path, { method = 'GET', timeout = 8000, fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(GARMIN_URL + path, { method, signal: AbortSignal.timeout(timeout) })
    if (!r.ok) return { offline: true, error: `Garmin Sync answered ${r.status}` }
    return await r.json()
  } catch (e) {
    return { offline: true, error: e?.name === 'TimeoutError' ? 'Garmin Sync did not answer in time' : 'Garmin Sync is not running' }
  }
}

/** Keeps at most n points, evenly spaced, always including the last. */
export function thin(points, n = 400) {
  if (!Array.isArray(points) || points.length <= n) return points || []
  const step = points.length / n
  const out = []
  for (let i = 0; i < n; i++) out.push(points[Math.floor(i * step)])
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1))
  return out
}

const STAGES = ['deep', 'light', 'rem', 'awake']
/** Minutes in each sleep stage, from stage changes [{ t, label }]. The last change has no end, so it is not counted. */
export function sleepTotals(points = []) {
  const mins = { deep: 0, light: 0, rem: 0, awake: 0 }
  for (let i = 0; i < points.length - 1; i++) {
    const k = String(points[i].label || '').toLowerCase()
    if (!(k in mins)) continue
    mins[k] += Math.max(0, (Date.parse(points[i + 1].t) - Date.parse(points[i].t)) / 60000)
  }
  for (const k of STAGES) mins[k] = Math.round(mins[k])
  const asleep = mins.deep + mins.light + mins.rem
  return { ...mins, asleep, start: points[0]?.t || null, end: points.at(-1)?.t || null }
}

/** The dashboard data, trimmed for the Health page: long series thinned, local file paths and addresses left out. */
export function shapeDashboard(d) {
  if (!d || d.offline) return d
  const { db_path, ...rest } = d
  const device = d.device ? { name: d.device.name, model: d.device.model, firmware: d.device.sw_version, lastSync: d.device.last_sync } : null
  const today = Object.fromEntries(Object.entries(d.today || {}).map(([k, v]) => [k, thin(v)]))
  const sleep = { day: d.sleep?.day || null, points: d.sleep?.points || [], totals: sleepTotals(d.sleep?.points || []) }
  return { ...rest, device, today, sleep, live: { start: d.live?.start || null, points: thin(d.live?.points || []) } }
}

/** Collector state, without the watch's Bluetooth address. */
export function shapeStatus(s) {
  if (!s || s.offline) return s
  const { address, ...device } = s.device || {}
  return { ...s, device: s.device ? device : null }
}

const vOf = (x) => (x && x.value != null ? x.value : null)
const roundOr = (v) => (v == null ? null : Math.round(v))
/** A compact summary for Claude: readings now, the last `days` days, last night's sleep and recent activities. */
export function summarize(status, dash, days = 14) {
  if (dash?.offline && status?.offline) return { available: false, why: dash.error, source: 'Garmin Sync', url: GARMIN_URL }
  const L = status?.latest || dash?.latest || {}
  const byDay = new Map()
  const put = (rows, f) => {
    for (const r of rows || []) {
      const row = byDay.get(r.d) || { date: r.d }
      f(row, r)
      byDay.set(r.d, row)
    }
  }
  const D = dash?.daily || {}
  put(D.hr, (o, r) => Object.assign(o, { hrAvg: roundOr(r.v), hrLow: roundOr(r.lo), hrHigh: roundOr(r.hi) }))
  put(D.stress, (o, r) => (o.stressAvg = roundOr(r.v)))
  put(D.steps, (o, r) => (o.steps = roundOr(r.v)))
  put(D.battery, (o, r) => Object.assign(o, { bodyBatteryLow: roundOr(r.lo), bodyBatteryHigh: roundOr(r.hi) }))
  put(D.hrv, (o, r) => (o.hrvNightAvg = roundOr(r.v)))
  const daily = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-days)
  const sl = dash?.sleep?.totals
  return {
    available: true,
    source: 'Garmin Sync (read only; use these numbers, do not invent others)',
    watch: status?.device?.name || dash?.device?.name || null,
    connected: !!status?.connected,
    lastSync: status?.last_sync || dash?.device?.lastSync || null,
    now: {
      heartRate: vOf(L.hr),
      restingHeartRate: vOf(L.resting_hr),
      stress: vOf(L.stress),
      bodyBattery: vOf(L.body_battery),
      steps: vOf(L.steps),
      stepsGoal: vOf(L.steps_goal),
      intensityMinutes: vOf(L.intensity_minutes),
      intensityGoal: vOf(L.intensity_goal),
      floorsUp: vOf(L.floors_up),
      floorsGoal: vOf(L.floors_goal),
      spo2: vOf(L.spo2),
      respiration: vOf(L.respiration),
      calories: vOf(L.calories),
      activeCalories: vOf(L.active_calories),
      at: L.hr?.ts || null
    },
    daily,
    sleep: sl && sl.asleep ? { night: dash.sleep.day, asleepMinutes: sl.asleep, deep: sl.deep, light: sl.light, rem: sl.rem, awake: sl.awake, start: sl.start, end: sl.end } : null,
    activities: (dash?.activities || []).slice(0, 10).map((a) => ({
      start: a.start_time,
      sport: a.sub_sport && a.sub_sport !== 'generic' ? `${a.sport} (${a.sub_sport})` : a.sport,
      minutes: a.elapsed_s != null ? Math.round(a.elapsed_s / 60) : null,
      km: a.distance_m ? +(a.distance_m / 1000).toFixed(2) : null,
      avgHr: a.avg_hr ?? null,
      maxHr: a.max_hr ?? null,
      calories: a.calories ?? null
    }))
  }
}

export async function healthSummary(days = 14, opts = {}) {
  const [status, dash] = await Promise.all([garmin('/api/status', opts), garmin('/api/dashboard', { ...opts, timeout: 15000 })])
  return summarize(shapeStatus(status), shapeDashboard(dash), days)
}

export const HEALTH_TOOL = {
  name: 'get_health',
  description:
    "Read the user's health data from their Garmin watch (via the Garmin Sync app on this computer): readings now (heart rate, resting heart rate, stress, body battery, steps against goal, intensity minutes, floors, SpO2, respiration, calories), daily averages for the last `days` days, last night's sleep by stage, and recent activities. Read only. Use it during check-ins and when re-planning health goals; returns available:false when Garmin Sync is not running.",
  inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90, description: 'How many days of daily averages (default 14)' } }, required: [] },
  annotations: { readOnlyHint: true }
}

// ---- filling metrics from the watch -------------------------------------------------------------------------------
const local = (t) => ymd(new Date(t))
const quarter = (x) => Math.round(x * 4) / 4
const hourOf = (t) => {
  const d = new Date(t)
  return d.getHours() + d.getMinutes() / 60
}
/**
 * Dated readings for every measure in HEALTH_SOURCES, from Garmin Sync's status and (shaped) dashboard:
 * [{ source, date, value }]. Daily values cover the last `days` days; today's are so far.
 */
export function healthReadings(status, dash, { days = 30, now = new Date() } = {}) {
  const out = []
  const from = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days))
  const add = (source, date, value) => date && date >= from && value != null && Number.isFinite(+value) && out.push({ source, date, value: +value })
  const rhr = status?.latest?.resting_hr || dash?.latest?.resting_hr
  if (rhr?.ts && rhr.value > 0) add('garmin.resting_hr', local(rhr.ts), Math.round(rhr.value))
  const D = dash?.daily || {}
  for (const r of D.steps || []) add('garmin.steps', r.d, Math.round(r.v))
  for (const r of D.hrv || []) add('garmin.hrv', r.d, Math.round(r.v))
  for (const r of D.stress || []) add('garmin.stress', r.d, Math.round(r.v))
  for (const r of D.battery || []) if (r.hi != null) add('garmin.body_battery', r.d, Math.round(r.hi))
  const sl = dash?.sleep?.totals
  if (sl?.asleep >= 60 && sl.end) {
    const woke = local(sl.end)
    add('garmin.sleep_hours', woke, Math.round((sl.asleep / 60) * 10) / 10)
    add('garmin.wake', woke, quarter(hourOf(sl.end)))
    const h0 = hourOf(sl.start)
    add('garmin.sleep_onset', woke, quarter(h0 >= 15 ? h0 - 24 : h0))
  }
  return out
}
/** The readings that would change a linked metric: [{ id, date, value }] for record_health. */
export function pendingReadings(db, readings) {
  const out = []
  for (const r of readings) {
    const m = db.metrics.find((x) => x.source === r.source)
    if (!m) continue
    const have = (m.entries || []).find((e) => e.date === r.date)
    if (!have || have.value !== r.value) out.push({ id: m.id, date: r.date, value: r.value })
  }
  return out
}
