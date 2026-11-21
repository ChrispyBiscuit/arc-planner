// The local API token. Every call to /api and /mcp must carry it, as "Authorization: Bearer <token>" or the
// arc_token cookie the desktop app sets for its own window. It lives in the user's home folder (not AppData) so
// command-line tools and the desktop app always see the same file.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_FILE = process.env.ARC_TOKEN_FILE || join(homedir(), '.arc-planner', 'token')
let cached = process.env.ARC_TOKEN || null

export function getToken() {
  if (cached) return cached
  if (existsSync(TOKEN_FILE)) cached = readFileSync(TOKEN_FILE, 'utf8').trim()
  if (!cached) {
    cached = randomBytes(24).toString('hex')
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    writeFileSync(TOKEN_FILE, cached + '\n', { mode: 0o600 })
  }
  return cached
}

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
export function cookieToken(req) {
  const m = /(?:^|;\s*)arc_token=([^;]+)/.exec(req.headers.cookie || '')
  return m ? decodeURIComponent(m[1]) : null
}
export function authorized(req) {
  const t = getToken()
  const h = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  return (h && same(h[1].trim(), t)) || (cookieToken(req) && same(cookieToken(req), t))
}
export const cookieHeader = (t) => `arc_token=${encodeURIComponent(t)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`
