// One-off: writes placeholder PWA icons. Re-run only to change the artwork.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BG = [236, 72, 153] // tailwind pink-500, matches the primary colour
const FG = [255, 255, 255]

// 5x7 glyphs for the letters C and M.
const GLYPHS = {
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
}

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

// textScale is the text block's share of the canvas; maskable icons need it
// inside the 80% safe zone.
function png(size, textScale) {
  const cell = Math.floor((size * textScale) / 11) // 5 + 1 gap + 5 columns
  const textW = cell * 11
  const textH = cell * 7
  const x0 = Math.floor((size - textW) / 2)
  const y0 = Math.floor((size - textH) / 2)
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1)
    for (let x = 0; x < size; x++) {
      let color = BG
      const gy = Math.floor((y - y0) / cell)
      if (y >= y0 && gy < 7 && x >= x0 && x < x0 + textW) {
        const gx = Math.floor((x - x0) / cell)
        const glyph = gx < 5 ? GLYPHS.C : gx >= 6 ? GLYPHS.M : null
        if (glyph && glyph[gy][gx < 5 ? gx : gx - 6] === '1') color = FG
      }
      raw.set(color, row + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const dir = new URL('../apps/web/public/icons/', import.meta.url)
mkdirSync(dir, { recursive: true })
const icons = {
  'icon-192.png': [192, 0.6],
  'icon-512.png': [512, 0.6],
  'icon-maskable-512.png': [512, 0.5],
  'apple-touch-icon.png': [180, 0.6],
}
for (const [name, [size, scale]] of Object.entries(icons)) {
  writeFileSync(new URL(name, dir), png(size, scale))
}
