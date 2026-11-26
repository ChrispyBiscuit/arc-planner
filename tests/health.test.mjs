// The Health page's server side: shaping Garmin Sync's data and summarising it for Claude.
import test from 'node:test'
import assert from 'node:assert/strict'
import { thin, sleepTotals, shapeDashboard, shapeStatus, summarize, garmin, healthReadings, pendingReadings, HEALTH_TOOL } from '../lib/health.mjs'
import { HEALTH_SOURCES } from '../public/shared.js'

test('thin keeps long series short, evenly spaced, with the last point', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i }))
  const out = thin(pts, 100)
  assert.ok(out.length <= 101)
  assert.equal(out[0].v, 0)
  assert.equal(out.at(-1).v, 999)
  assert.deepEqual(thin(pts.slice(0, 5), 100).length, 5)
  assert.deepEqual(thin(undefined), [])
})

test('sleep totals add up each stage and leave the last, open-ended change out', () => {
  const at = (m) => new Date(Date.UTC(2026, 0, 1, 23, 0) + m * 60000).toISOString()
  const pts = [
    { t: at(0), label: 'Light' },
    { t: at(30), label: 'Deep' },
    { t: at(90), label: 'REM' },
    { t: at(110), label: 'Awake' },
    { t: at(115), label: 'Light' },
    { t: at(175), label: 'Awake' }
  ]
  const s = sleepTotals(pts)
  assert.deepEqual([s.light, s.deep, s.rem, s.awake, s.asleep], [90, 60, 20, 5, 170])
  assert.equal(s.start, at(0))
  assert.equal(s.end, at(175))
  assert.equal(sleepTotals([]).asleep, 0)
})

test('the page never receives the database path or the watch address', () => {
  const d = shapeDashboard({ db_path: 'C:/x/garmin.db', device: { name: 'W', model: 'M', sw_version: '1', address: 'AA:BB', last_sync: 'z' }, today: { hr: [] }, sleep: { points: [] }, daily: {} })
  assert.equal('db_path' in d, false)
  assert.equal(JSON.stringify(d).includes('AA:BB'), false)
  assert.equal(d.device.firmware, '1')
  const s = shapeStatus({ connected: true, device: { name: 'W', address: 'AA:BB' } })
  assert.equal(JSON.stringify(s).includes('AA:BB'), false)
  assert.deepEqual(shapeDashboard({ offline: true }), { offline: true })
})

test('the summary for Claude merges daily rows by date and reports readings now', () => {
  const status = { connected: true, device: { name: 'W' }, last_sync: 's', latest: { hr: { value: 70, ts: 't' }, steps: { value: 5000 }, steps_goal: { value: 8000 } } }
  const dash = shapeDashboard({
    daily: { hr: [{ d: '2026-01-01', v: 70.4, lo: 50, hi: 120 }, { d: '2026-01-02', v: 72, lo: 51, hi: 130 }], steps: [{ d: '2026-01-02', v: 9000 }], stress: [], battery: [], hrv: [{ d: '2026-01-02', v: 48 }] },
    sleep: { day: null, points: [] },
    activities: [{ start_time: 'a', sport: 'running', sub_sport: 'trail', elapsed_s: 1260, distance_m: 2790, avg_hr: 150 }]
  })
  const s = summarize(status, dash, 1)
  assert.equal(s.available, true)
  assert.equal(s.now.heartRate, 70)
  assert.equal(s.now.stepsGoal, 8000)
  assert.deepEqual(s.daily, [{ date: '2026-01-02', hrAvg: 72, hrLow: 51, hrHigh: 130, steps: 9000, hrvNightAvg: 48 }])
  assert.equal(s.sleep, null)
  assert.deepEqual(s.activities[0], { start: 'a', sport: 'running (trail)', minutes: 21, km: 2.79, avgHr: 150, maxHr: null, calories: null })
  assert.equal(summarize({ offline: true, error: 'x' }, { offline: true, error: 'down' }).available, false)
})

test('readings for each measure, dated by local day, with sleep dated by the morning you woke', () => {
  const now = new Date(2026, 10, 25, 21, 0)
  const loc = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString()
  const status = { latest: { resting_hr: { value: 54, ts: loc(25, 20) } } }
  const dash = {
    daily: { steps: [{ d: '2026-11-24', v: 8123 }, { d: '2026-09-01', v: 1 }], hrv: [{ d: '2026-11-25', v: 47.6 }], stress: [{ d: '2026-11-25', v: 31.2 }], battery: [{ d: '2026-11-25', lo: 20, v: 50, hi: 88 }] },
    sleep: { totals: { asleep: 400, start: loc(24, 23, 40), end: loc(25, 7, 10) } }
  }
  const r = Object.fromEntries(healthReadings(status, dash, { now }).map((x) => [x.source, [x.date, x.value]]))
  assert.deepEqual(r, {
    'garmin.resting_hr': ['2026-11-25', 54],
    'garmin.steps': ['2026-11-24', 8123],
    'garmin.hrv': ['2026-11-25', 48],
    'garmin.stress': ['2026-11-25', 31],
    'garmin.body_battery': ['2026-11-25', 88],
    'garmin.sleep_hours': ['2026-11-25', 6.7],
    'garmin.wake': ['2026-11-25', 7.25],
    'garmin.sleep_onset': ['2026-11-25', -0.25]
  })
  for (const k of Object.keys(r)) assert.ok(HEALTH_SOURCES[k], k)
  // After midnight counts forward; a short nap is not a night's sleep.
  const late = healthReadings({}, { sleep: { totals: { asleep: 300, start: loc(25, 2, 5), end: loc(25, 8) } } }, { now })
  assert.equal(late.find((x) => x.source === 'garmin.sleep_onset').value, 2)
  assert.equal(healthReadings({}, { sleep: { totals: { asleep: 40, start: loc(25, 13), end: loc(25, 14) } } }, { now }).length, 0)
})

test('only new or changed readings are written, to the metric linked to each measure', () => {
  const db = { metrics: [{ id: 'a', source: 'garmin.steps', entries: [{ date: '2026-11-24', value: 8000 }, { date: '2026-11-23', value: 5 }] }, { id: 'b', entries: [] }] }
  const readings = [
    { source: 'garmin.steps', date: '2026-11-24', value: 8123 },
    { source: 'garmin.steps', date: '2026-11-23', value: 5 },
    { source: 'garmin.steps', date: '2026-11-25', value: 100 },
    { source: 'garmin.hrv', date: '2026-11-25', value: 40 }
  ]
  assert.deepEqual(pendingReadings(db, readings), [{ id: 'a', date: '2026-11-24', value: 8123 }, { id: 'a', date: '2026-11-25', value: 100 }])
})

test('an unreachable Garmin Sync is reported, not thrown', async () => {
  const down = await garmin('/api/status', { fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepEqual(down, { offline: true, error: 'Garmin Sync is not running' })
  const bad = await garmin('/api/status', { fetchImpl: async () => ({ ok: false, status: 500 }) })
  assert.equal(bad.offline, true)
  const ok = await garmin('/api/status', { fetchImpl: async () => ({ ok: true, json: async () => ({ connected: true }) }) })
  assert.deepEqual(ok, { connected: true })
  assert.equal(HEALTH_TOOL.annotations.readOnlyHint, true)
})
