// Date logic, run in a zone with daylight-saving changes (US Central) so day arithmetic is tested across them.
process.env.TZ = 'America/Chicago'
import test from 'node:test'
import assert from 'node:assert/strict'

const { addDays, addMonths, daysBetween, isoWeek, weekStart, weekDays, periodsFor, ageOn, ymd, parse, decadeOf, daysInMonth, periodLabel } = await import('../public/shared.js')
const { periodEnd, periodStart, itemEnd } = await import('../public/model.js')

test('day arithmetic is stable across daylight-saving changes', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08')
  assert.equal(addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-11-01', 1), '2026-11-02')
  assert.equal(addDays('2026-11-02', -2), '2026-10-31')
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2)
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2)
  assert.equal(ymd(parse('2026-03-08')), '2026-03-08')
})

test('month arithmetic clamps to the last day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28')
  assert.equal(daysInMonth(2028, 2), 29)
})

test('ISO weeks at year boundaries', () => {
  assert.equal(isoWeek('2026-01-01').key, '2026-W01')
  assert.equal(isoWeek('2027-01-01').key, '2026-W53')
  assert.equal(isoWeek('2024-12-30').key, '2025-W01')
  assert.equal(isoWeek('2026-11-22').key, '2026-W47')
  assert.equal(isoWeek('2026-11-23').key, '2026-W48')
  assert.equal(weekStart('2026-11-22'), '2026-11-16')
  assert.equal(weekStart('2026-11-23'), '2026-11-23')
  assert.deepEqual(weekDays('2026-11-20'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
})

test('periods for a date and their labels', () => {
  assert.deepEqual(periodsFor('2026-11-21'), { week: '2026-W47', month: '2026-11', year: '2026', decade: '2020', life: 'life' })
  assert.equal(decadeOf(2029), 2020)
  assert.equal(periodLabel('decade', '2020'), '2020s')
  assert.equal(periodLabel('week', '2026-W07'), 'Week 7, 2026')
})

test('period starts and ends', () => {
  const db = { profile: { birthDate: '1990-07-01', lifeExpectancy: 85 } }
  assert.equal(periodEnd(db, 'week', '2026-W53'), '2027-01-03')
  assert.equal(periodStart(db, 'week', '2026-W53'), '2026-12-28')
  assert.equal(periodEnd(db, 'week', '2026-W47'), '2026-11-22')
  assert.equal(periodEnd(db, 'month', '2028-02'), '2028-02-29')
  assert.equal(periodEnd(db, 'year', '2027'), '2027-12-31')
  assert.equal(periodEnd(db, 'decade', '2030'), '2039-12-31')
  assert.equal(periodEnd(db, 'life', 'life'), '2075-12-31')
  // A decade that runs past the end of the arc ends with it.
  assert.equal(itemEnd(db, { horizon: 'decade', period: '2070' }, 'goal'), '2075-12-31')
  assert.equal(itemEnd(db, { horizon: 'year', period: '2027', end: '2027-06-30' }, 'goal'), '2027-06-30')
  assert.equal(itemEnd(db, { date: '2026-12-04' }, 'task'), '2026-12-04')
})

test('age on a date', () => {
  assert.equal(ageOn('1990-07-01', '2026-06-30'), 35)
  assert.equal(ageOn('1990-07-01', '2026-07-01'), 36)
  assert.equal(ageOn('', '2026-07-01'), null)
})
