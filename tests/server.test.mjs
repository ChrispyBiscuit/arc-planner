// The HTTP server: token, host checks, CSP, the JSON API and the MCP endpoint.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'arc-http-'))
process.env.ARC_DATA = join(dir, 'plan.json')
process.env.ARC_TOKEN = 'test-token'
process.env.ARC_VERSION = '9.9.9'
const { start } = await import('../server.mjs')
const server = await start(0)
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => server.close())

const auth = { authorization: 'Bearer test-token' }
const post = (path, body, headers = auth) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const mcp = async (body) => (await post('/mcp', body)).json()

test('the API needs the token; static files do not', async () => {
  assert.equal((await fetch(base + '/api/state')).status, 401)
  assert.equal((await fetch(base + '/api/state', { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await fetch(base + '/api/state', { headers: auth })).status, 200)
  assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, {})).status, 401)
  const page = await fetch(base + '/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/)
  assert.match(await page.text(), /app\.js\?v=9\.9\.9/)
})

test('opening /?token= signs a browser in with a cookie', async () => {
  const r = await fetch(base + '/?token=test-token', { redirect: 'manual' })
  assert.equal(r.status, 302)
  const cookie = r.headers.get('set-cookie')
  assert.match(cookie, /arc_token=test-token; HttpOnly; SameSite=Strict/)
  assert.equal((await fetch(base + '/api/rev', { headers: { cookie: 'arc_token=test-token' } })).status, 200)
  assert.equal((await fetch(base + '/?token=nope', { redirect: 'manual' })).status, 401)
})

test('foreign hosts and origins are refused', async () => {
  // fetch() will not let us set Host, so use a raw request.
  const { request } = await import('node:http')
  const status = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path: '/api/state', headers: { host: 'evil.example', ...auth } }, (res) => resolve(res.statusCode))
    req.end()
  })
  assert.equal(status, 403)
  assert.equal((await post('/api/op', { op: 'get_day' }, { ...auth, origin: 'http://evil.example' })).status, 403)
})

test('MCP: initialize, list, call, batch and notifications', async () => {
  assert.equal((await post('/api/op', { op: 'set_policy', args: { excluded: ['therapy'] } })).status, 200)
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  assert.equal(init.result.serverInfo.version, '9.9.9')
  assert.match(init.result.instructions, /Excluded topics/)
  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const names = list.result.tools.map((t) => t.name)
  assert.ok(names.includes('upsert_goal') && names.includes('close_item') && names.includes('get_templates'))
  assert.ok(!names.includes('set_policy'))
  const call = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'upsert_task', arguments: { title: 'Call the firm' } } })
  const task = JSON.parse(call.result.content[0].text)
  assert.equal(task.status, 'proposed')
  assert.equal(task.origin, 'claude')
  const refused = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_fact', arguments: { title: 'Therapy notes' } } })
  assert.equal(refused.result.isError, true)
  const hidden = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'set_policy', arguments: { excluded: [] } } })
  assert.equal(hidden.error.code, -32602)
  const batch = await mcp([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }])
  assert.equal(batch.length, 1)
  assert.equal((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
})

test('the dashboard API refuses stale writes with 409', async () => {
  const { rev } = await (await fetch(base + '/api/rev', { headers: auth })).json()
  const ok = await post('/api/op', { op: 'add_fact', args: { title: 'One' }, basedOnRev: rev })
  assert.equal(ok.status, 200)
  const stale = await post('/api/op', { op: 'add_fact', args: { title: 'Two' }, basedOnRev: rev })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).code, 'STALE')
  const bad = await post('/api/op', { op: 'close_item', args: { ref: 'nope', status: 'done' } })
  assert.equal(bad.status, 400)
  const imp = await fetch(base + `/api/import?basedOnRev=${rev}`, { method: 'POST', headers: auth, body: JSON.stringify({ profile: {}, goals: [], routines: [] }) })
  assert.equal(imp.status, 409)
})
