#!/usr/bin/env node
// Arc: a life-plan dashboard with an MCP endpoint.
//   node server.mjs           dashboard at http://127.0.0.1:4747 and MCP (Streamable HTTP) at /mcp
//   node server.mjs --stdio   MCP over stdio, for clients that launch the server themselves
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPS, run, load, importPlan, FILE } from './lib/ops.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(ROOT, 'public')
const PORT = +(process.env.ARC_PORT || 4747)

// ---- MCP (JSON-RPC 2.0) -----------------------------------------------------------------------------------------
const INSTRUCTIONS = `Arc is the user's life plan: daily targets that roll up into week, month, year, decade and life goals, on an arc from today to the end of life.
Daily loop: call get_overview first. When the user reports what happened, record it with check_in (item results, metrics, sleep, a summary), then adjust what comes next: plan_day for tomorrow's brief and one-off tasks, upsert_routine for recurring targets, upsert_goal for goals. Keep every goal linked upward with parentId.
Re-plan from evidence: use get_performance before changing targets, raise what is being met easily, shrink or reschedule what is being missed, and write the reasoning with log_revision. Never invent results the user did not report. The user sees every change live in the dashboard.`

const tools = () =>
  Object.entries(OPS).map(([name, op]) => ({
    name,
    description: op.desc,
    inputSchema: { type: 'object', properties: op.args || {}, required: op.required || [] },
    annotations: { readOnlyHint: !op.write }
  }))

function rpc(msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request')
  if (msg.id === undefined) return null // notification
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'arc', title: 'Arc life plan', version: '1.0.0' },
        instructions: INSTRUCTIONS
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: tools() })
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {}
      if (!OPS[name]) return fail(-32602, `Unknown tool: ${name}`)
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
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let out
    try {
      out = rpc(JSON.parse(line))
    } catch {
      out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
    }
    if (out) process.stdout.write(JSON.stringify(out) + '\n')
  })
}

// ---- HTTP: dashboard, JSON API and MCP --------------------------------------------------------------------------
/** Starts the dashboard and MCP endpoint. Resolves once listening; rejects if the port is taken. */
export function start(port = PORT) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' }
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
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

  const server = createServer(async (req, res) => {
    try {
      // Only this machine may talk to the plan: reject foreign Host and Origin headers (DNS-rebinding and cross-site posts).
      const origin = req.headers.origin
      if (!LOCAL.test(req.headers.host || '') || (origin && !LOCAL.test(origin.replace(/^https?:\/\//, '')))) return json(res, 403, { error: 'Local access only' })
      const url = new URL(req.url, 'http://x')

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return res.writeHead(405, { allow: 'POST' }).end()
        let msg
        try {
          msg = JSON.parse(await body(req))
        } catch {
          return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        }
        const out = Array.isArray(msg) ? msg.map(rpc).filter(Boolean) : rpc(msg)
        if (!out || (Array.isArray(out) && !out.length)) return res.writeHead(202).end()
        return json(res, 200, out)
      }
      if (url.pathname === '/api/state') return json(res, 200, load())
      if (url.pathname === '/api/version') return json(res, 200, { version: process.env.ARC_VERSION || 'dev', desktop: !!process.versions.electron, file: FILE })
      if (url.pathname === '/api/rev') return json(res, 200, { rev: load().rev })
      if (url.pathname === '/api/op' && req.method === 'POST') {
        const { op, args } = JSON.parse(await body(req))
        try {
          return json(res, 200, { result: run(op, args || {}, 'you') })
        } catch (e) {
          return json(res, 400, { error: String(e.message || e) })
        }
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        try {
          return json(res, 200, { result: importPlan(JSON.parse(await body(req))) })
        } catch (e) {
          return json(res, 400, { error: String(e.message || e) })
        }
      }
      if (req.method !== 'GET') return res.writeHead(405).end()
      const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
      if (rel.startsWith('..')) return res.writeHead(403).end()
      const data = await readFile(join(PUBLIC, rel)).catch(() => null)
      if (!data) return res.writeHead(404).end('Not found')
      res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream', 'cache-control': extname(rel) === '.woff2' ? 'max-age=31536000' : 'no-cache' })
      res.end(data)
    } catch (e) {
      json(res, 500, { error: String(e.message || e) })
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// Run directly with Node (not inside the desktop app, which calls start() itself).
if (!STDIO && !process.versions.electron) {
  start().then(
    () => {
      console.log(`Arc dashboard  http://127.0.0.1:${PORT}`)
      console.log(`MCP endpoint   http://127.0.0.1:${PORT}/mcp`)
      console.log(`Plan file      ${FILE}`)
    },
    (e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Arc may already be running.` : e)
      process.exit(1)
    }
  )
}
