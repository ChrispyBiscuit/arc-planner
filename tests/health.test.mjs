// The Health page's server side: shaping Garmin Sync's data and summarising it for Claude.
import test from 'node:test'
import assert from 'node:assert/strict'
import { thin, sleepTotals, shapeDashboard, shapeStatus, summarize, garmin, HEALTH_TOOL } from '../lib/health.mjs'

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

test('an unreachable Garmin Sync is reported, not thrown', async () => {
  const down = await garmin('/api/status', { fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepEqual(down, { offline: true, error: 'Garmin Sync is not running' })
  const bad = await garmin('/api/status', { fetchImpl: async () => ({ ok: false, status: 500 }) })
  assert.equal(bad.offline, true)
  const ok = await garmin('/api/status', { fetchImpl: async () => ({ ok: true, json: async () => ({ connected: true }) }) })
  assert.deepEqual(ok, { connected: true })
  assert.equal(HEALTH_TOOL.annotations.readOnlyHint, true)
})
