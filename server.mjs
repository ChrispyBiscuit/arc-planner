#!/usr/bin/env node
// Arc: a life-plan dashboard with an MCP endpoint.
//   node server.mjs           dashboard at http://127.0.0.1:4747 and MCP (Streamable HTTP) at /mcp
//   node server.mjs --stdio   MCP over stdio. If the dashboard is running it forwards there, so one process owns
//                             the plan file; otherwise it serves from the file itself.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { extname, join, normalize, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPS, run, load, importPlan, FILE } from './lib/ops.mjs'
import { desktop } from './lib/desktop.mjs'
import { getToken, authorized, cookieHeader, TOKEN_FILE } from './lib/auth.mjs'
import { GARMIN_URL, garmin, shapeDashboard, shapeStatus, healthSummary, healthReadings, pendingReadings, HEALTH_TOOL } from './lib/health.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(ROOT, 'public')
const PORT = +(process.env.ARC_PORT || 4747)
const VERSION = process.env.ARC_VERSION || 'dev'

// ---- MCP (JSON-RPC 2.0) -----------------------------------------------------------------------------------------
const instructions = () => {
  const excluded = (load().policy?.excluded || []).join(', ')
  return `Arc is the user's life plan: tasks that roll up into week, month, year, decade and life goals, on an arc from today to the end of life.
Daily loop: call get_overview first. When the user reports what happened, record it with check_in (item results, metrics, sleep, a summary), then adjust what comes next: plan_day for tomorrow's brief and tasks, upsert_routine for recurring targets, upsert_goal for goals.
Structure: every goal and task has a type, a parent one horizon up, why, requirements, a proposal (how), checkable acceptance criteria and a target end date. Call get_templates before creating items and follow them. Writes return the linter verdict; new items that are not complete are saved as proposals for the user to review. Close items with close_item; done requires every acceptance criterion met (tick yes-or-no ones with update_criterion when the user reports them).
Ownership: to change existing goals or tasks (restructure, re-date, re-parent, drop), use propose_changes; the user accepts or rejects each in their Inbox. Only the user can accept. Missed items appear in list_overdue and get_overview.overdue; settle them with triage (move, done, routine, drop) when the user says what they want.
A doable day: each day has up to three focus items (set_focus, or focus in plan_day) and a capacity in minutes; get_day and get_overview show the load. You cannot add a task to a day that is full: the error names the next day with room. Use balance_days to plan moves off full days and show them to the user. Decisions are items of type decision with a question and options; record what the user chose with decide.
Re-plan from evidence: use get_performance and lint_plan before changing targets, raise what is being met easily, shrink or reschedule what is being missed, and write the reasoning with log_revision. Never invent results the user did not report. The user sees every change live in the dashboard.
Excluded topics (never add these; writes mentioning them are refused): ${excluded || 'none'}.`
}

const tools = () =>
  Object.entries(OPS)
    .filter(([, op]) => !op.userOnly)
    .map(([name, op]) => ({
      name,
      description: op.desc,
      inputSchema: { type: 'object', properties: op.args || {}, required: op.required || [] },
      annotations: { readOnlyHint: !op.write }
    }))
    .concat([HEALTH_TOOL])

async function rpc(msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code, message } })
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request')
  if (msg.id === undefined) return null // notification
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'arc', title: 'Arc life plan', version: VERSION },
        instructions: instructions()
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: tools() })
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {}
      if (name === HEALTH_TOOL.name) {
        const days = Math.max(1, Math.min(90, Math.round(+args?.days || 14)))
        return reply({ content: [{ type: 'text', text: JSON.stringify(await healthSummary(days), null, 1) }] })
      }
      if (!OPS[name] || OPS[name].userOnly) return fail(-32602, `Unknown tool: ${name}`)
      try {
        return reply({ content: [{ type: 'text', text: JSON.stringify(run(name, args || {}, 'claude'), null, 1) }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String(e.message || e) }], isError: true })
      }
    }
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

const STDIO = process.argv.includes('--stdio')
if (STDIO) {
  // Forward to the running app when there is one, so only one process ever writes the plan.
  const forward = async (msg) => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` }, body: JSON.stringify(msg), signal: AbortSignal.timeout(30000) })
      if (r.status === 202) return null
      if (r.ok) return await r.json()
    } catch {}
    return undefined
  }
  const rl = createInterface({ input: process.stdin })
  let chain = Promise.resolve()
  rl.on('line', (line) => {
    if (!line.trim()) return
    chain = chain.then(async () => {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      }
      let out = await forward(msg)
      if (out === undefined) out = await rpc(msg)
      if (out) process.stdout.write(JSON.stringify(out) + '\n')
    })
  })
}

// ---- health: metrics linked to a Garmin measure are filled in the background --------------------------------------
let healthRun = null
/** Reads Garmin Sync and writes any new or changed readings into linked metrics. Does nothing when none are linked. */
export function logHealth() {
  healthRun ||= (async () => {
    try {
      if (!load().metrics.some((m) => m.source)) return { logged: 0, linked: 0 }
      const [s, d] = await Promise.all([garmin('/api/status'), garmin('/api/dashboard', { timeout: 15000 })])
      if (d.offline) return { logged: 0, offline: true, error: d.error }
      const pending = pendingReadings(load(), healthReadings(shapeStatus(s), shapeDashboard(d)))
      return pending.length ? run('record_health', { readings: pending }, 'you') : { logged: 0 }
    } catch (e) {
      return { logged: 0, error: String(e.message || e) }
    } finally {
      healthRun = null
    }
  })()
  return healthRun
}

// ---- HTTP: dashboard, JSON API and MCP --------------------------------------------------------------------------
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

/** Starts the dashboard and MCP endpoint. Resolves once listening; rejects if the port is taken. */
export function start(port = PORT) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' }
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
  getToken()

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(body))
  }
  const body = (req) =>
    new Promise((resolve, reject) => {
      let s = ''
      req.on('data', (c) => {
        s += c
        if (s.length > 2e7) reject(new Error('Body too large'))
      })
      req.on('end', () => resolve(s))
      req.on('error', reject)
    })
  const fail = (res, e) => json(res, e.code === 'STALE' ? 409 : 400, { error: String(e.message || e), code: e.code, rev: e.rev, unmet: e.unmet })

  const server = createServer(async (req, res) => {
    try {
      // Only this machine may talk to the plan: reject foreign Host and Origin headers (DNS-rebinding and cross-site posts).
      const origin = req.headers.origin
      if (!LOCAL.test(req.headers.host || '') || (origin && !LOCAL.test(origin.replace(/^https?:\/\//, '')))) return json(res, 403, { error: 'Local access only' })
      const url = new URL(req.url, 'http://x')

      // Opening /?token=<token> once in a browser signs that browser in with a cookie.
      if (url.pathname === '/' && url.searchParams.has('token')) {
        if (url.searchParams.get('token') !== getToken()) return json(res, 401, { error: 'Wrong token' })
        res.writeHead(302, { location: '/' + (url.hash || ''), 'set-cookie': cookieHeader(getToken()), 'cache-control': 'no-store' })
        return res.end()
      }
      const isApi = url.pathname === '/mcp' || url.pathname.startsWith('/api/')
      if (isApi && !authorized(req)) return json(res, 401, { error: `Missing or wrong token. It is in ${TOKEN_FILE}.` })

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return res.writeHead(405, { allow: 'POST' }).end()
        let msg
        try {
          msg = JSON.parse(await body(req))
        } catch {
          return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        }
        const out = Array.isArray(msg) ? (await Promise.all(msg.map(rpc))).filter(Boolean) : await rpc(msg)
        if (!out || (Array.isArray(out) && !out.length)) return res.writeHead(202).end()
        return json(res, 200, out)
      }
      if (url.pathname === '/api/state') return json(res, 200, load())
      if (url.pathname === '/api/version') return json(res, 200, { version: VERSION, desktop: !!process.versions.electron, file: FILE, tokenFile: TOKEN_FILE })
      if (url.pathname === '/api/rev') return json(res, 200, { rev: load().rev })
      if (url.pathname === '/api/token') return json(res, 200, { token: getToken(), file: TOKEN_FILE, mcp: `http://127.0.0.1:${port}/mcp` })
      if (url.pathname === '/api/op' && req.method === 'POST') {
        const { op, args, basedOnRev } = JSON.parse(await body(req))
        try {
          return json(res, 200, { result: run(op, args || {}, 'you', { basedOnRev }), rev: load().rev })
        } catch (e) {
          return fail(res, e)
        }
      }
      // Health: the Garmin Sync app on this machine, read through Arc so the page needs no other origin.
      if (url.pathname === '/api/health/status') return json(res, 200, { ...shapeStatus(await garmin('/api/status')), source: GARMIN_URL })
      if (url.pathname === '/api/health/dashboard') return json(res, 200, shapeDashboard(await garmin('/api/dashboard', { timeout: 15000 })))
      if (url.pathname === '/api/health/log' && req.method === 'POST') return json(res, 200, await logHealth())
      if (url.pathname === '/api/health/sync' && req.method === 'POST') return json(res, 200, await garmin('/api/sync', { method: 'POST' }))
      if (url.pathname === '/api/update') {
        if (req.method === 'POST') {
          const { action } = JSON.parse(await body(req))
          if (action === 'check') desktop.check?.()
          if (action === 'install') desktop.install?.()
        }
        return json(res, 200, desktop.status ? desktop.status() : { desktop: false, version: VERSION, state: 'Updates are handled by the installed app' })
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        try {
          return json(res, 200, { result: importPlan(JSON.parse(await body(req)), url.searchParams.get('basedOnRev')) })
        } catch (e) {
          return fail(res, e)
        }
      }
      if (isApi) return json(res, 404, { error: 'Not found' })
      if (req.method !== 'GET') return res.writeHead(405).end()
      const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
      if (rel.startsWith('..')) return res.writeHead(403).end()
      let data = await readFile(join(PUBLIC, rel)).catch(() => null)
      if (!data) return res.writeHead(404).end('Not found')
      // Scripts and styles must never be served stale after an update: nothing is cached, and the page asks for
      // them under the running version so even a browser's in-memory module cache misses.
      if (rel === 'index.html') data = String(data).replace(/(app\.js|styles\.css|boot\.js)"/g, `$1?v=${encodeURIComponent(process.env.ARC_VERSION || Date.now())}"`)
      res.writeHead(200, {
        'content-type': MIME[extname(rel)] || 'application/octet-stream',
        'cache-control': extname(rel) === '.woff2' ? 'max-age=31536000' : 'no-store',
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      })
      res.end(data)
    } catch (e) {
      json(res, 500, { error: String(e.message || e) })
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      // Linked health metrics fill themselves: shortly after start, then every 15 minutes.
      setTimeout(logHealth, 20000).unref()
      setInterval(logHealth, 15 * 60000).unref()
      resolve(server)
    })
  })
}

// Run directly with Node (not inside the desktop app, which calls start() itself).
if (!STDIO && !process.versions.electron && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().then(
    () => {
      console.log(`Arc dashboard  http://127.0.0.1:${PORT}/?token=${getToken()}`)
      console.log(`MCP endpoint   http://127.0.0.1:${PORT}/mcp  (header: Authorization: Bearer <token in ${TOKEN_FILE}>)`)
      console.log(`Plan file      ${FILE}`)
    },
    (e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Arc may already be running.` : e)
      process.exit(1)
    }
  )
}
