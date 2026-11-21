// Draws build/icon.png (256 px): an arc from lower left to lower right on Arc's panel grey, with a marker dot
// where "today" sits on it. No dependencies: the PNG is encoded by hand.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const N = 256
const SS = 4
const px = Buffer.alloc(N * N * 4)
const BG = [27, 27, 27]
const INK = [237, 237, 237]
const MARK = [242, 199, 68]

function sample(x, y) {
  // rounded square
  const r = 56
  const dx = Math.max(r - x, x - (N - r), 0)
  const dy = Math.max(r - y, y - (N - r), 0)
  if (dx * dx + dy * dy > r * r) return null
  const cx = 128
  const cy = 176
  const d = Math.hypot(x - cx, y - cy)
  const a = Math.atan2(cy - y, x - cx) // 0 = east, pi = west, upper half positive
  const mx = cx + 88 * Math.cos(Math.PI * 0.62)
  const my = cy - 88 * Math.sin(Math.PI * 0.62)
  if (Math.hypot(x - mx, y - my) < 17) return MARK
  if (Math.hypot(x - mx, y - my) < 25) return BG
  if (Math.abs(d - 88) < 11 && a > -0.02 && a < Math.PI + 0.02) return INK
  return BG
}
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < SS; i++)
      for (let j = 0; j < SS; j++) {
        const c = sample(x + (i + 0.5) / SS, y + (j + 0.5) / SS)
        if (c) { r += c[0]; g += c[1]; b += c[2]; n++ }
      }
    const o = (y * N + x) * 4
    if (n) { px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n }
    px[o + 3] = (n / (SS * SS)) * 255
  }
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const raw = Buffer.alloc(N * (N * 4 + 1))
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
console.log('build/icon.png written')
