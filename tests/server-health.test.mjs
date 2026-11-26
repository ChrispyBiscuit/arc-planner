// The background job that fills linked metrics from the watch, against a throwaway plan and no Garmin Sync.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ARC_DATA = join(mkdtempSync(join(tmpdir(), 'arc-health-')), 'plan.json')
process.env.ARC_GARMIN_URL = 'http://127.0.0.1:9' // nothing listens here
const { run } = await import('../lib/ops.mjs')
const { logHealth } = await import('../server.mjs')

test('a check with nothing linked does not stick: linking a metric afterwards is seen', async () => {
  assert.deepEqual(await logHealth(), { logged: 0, linked: 0 })
  assert.deepEqual(await logHealth(), { logged: 0, linked: 0 })
  run('upsert_metric', { name: 'Steps', source: 'garmin.steps' })
  const r = await logHealth()
  assert.equal(r.offline, true, 'it went on to ask Garmin Sync, which is not running')
})

test('a call during a run waits for it and then runs again', async () => {
  const [a, b] = await Promise.all([logHealth(), logHealth()])
  assert.equal(a.offline, true)
  assert.equal(b.offline, true)
})
