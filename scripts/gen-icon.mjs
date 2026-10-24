/**
 * 生成应用图标与托盘图标（纯 Node 实现 PNG 编码，无第三方依赖）
 * 输出: resources/tray.png (32x32), build/icon.png (256x256)
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 绘制 ----------
const BLUE = [46, 124, 246, 255] // #2E7CF6
const WHITE = [255, 255, 255, 255]

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false
  const dx = Math.max(x + r - px, px - (x + w - r), 0)
  const dy = Math.max(y + r - py, py - (y + h - r), 0)
  return dx * dx + dy * dy <= r * r
}

function insideCircle(px, py, cx, cy, r) {
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4)
  const set = (x, y, c) => {
    const i = (y * S + x) * 4
    buf[i] = c[0]
    buf[i + 1] = c[1]
    buf[i + 2] = c[2]
    buf[i + 3] = c[3]
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 背景：圆角方块
      if (!insideRoundedRect(x, y, S * 0.02, S * 0.02, S * 0.96, S * 0.96, S * 0.22)) continue
      set(x, y, BLUE)
      // 取景框凸起
      if (insideRoundedRect(x, y, S * 0.36, S * 0.2, S * 0.28, S * 0.16, S * 0.04)) set(x, y, WHITE)
      // 机身
      if (insideRoundedRect(x, y, S * 0.16, S * 0.3, S * 0.68, S * 0.46, S * 0.07)) {
        set(x, y, WHITE)
        // 镜头
        if (insideCircle(x + 0.5, y + 0.5, S * 0.5, S * 0.53, S * 0.13)) set(x, y, BLUE)
        if (insideCircle(x + 0.5, y + 0.5, S * 0.5, S * 0.53, S * 0.055)) set(x, y, WHITE)
        // 闪光灯
        if (insideRoundedRect(x, y, S * 0.66, S * 0.36, S * 0.09, S * 0.05, S * 0.02)) set(x, y, BLUE)
      }
    }
  }
  return buf
}

mkdirSync(join(root, 'resources'), { recursive: true })
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'resources', 'tray.png'), encodePng(32, 32, drawIcon(32)))
writeFileSync(join(root, 'build', 'icon.png'), encodePng(256, 256, drawIcon(256)))
console.log('icons generated: resources/tray.png, build/icon.png')
