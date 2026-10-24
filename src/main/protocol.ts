import { app, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { CAPTURE_SCHEME } from '../shared/types'
import { mkdirSync } from 'fs'

const captureDir = () => join(app.getPath('temp'), 'wxwork-screenshot')

/** 本轮截图的 PNG 数据直接驻留内存，避免每次截图都写盘再读盘 */
const captureBuffers = new Map<string, Buffer>()

export function getCaptureDir(): string {
  return captureDir()
}

export function ensureCaptureDir(): string {
  const dir = captureDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function putCaptureBuffer(name: string, png: Buffer): void {
  captureBuffers.set(name, png)
}

export function hasCaptureBuffer(name: string): boolean {
  return captureBuffers.has(name)
}

export function clearCaptureBuffers(): void {
  captureBuffers.clear()
}

/** 必须在 app ready 之前调用 */
export function registerCaptureScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CAPTURE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true
      }
    }
  ])
}

/** app ready 之后调用：wxshot://cap/<file>.png → 内存中的抓屏数据（兼容旧临时文件） */
export function registerCaptureProtocolHandler(): void {
  protocol.handle(CAPTURE_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const name = decodeURIComponent(pathname.replace(/^\/+/, ''))
    // 只允许纯文件名，防目录穿越
    if (!/^[A-Za-z0-9_-]+\.png$/.test(name)) {
      return new Response('forbidden', { status: 403 })
    }
    const headers = {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
    const cached = captureBuffers.get(name)
    if (cached) {
      return new Response(new Uint8Array(cached), { headers })
    }
    const filePath = join(ensureCaptureDir(), name)
    try {
      const resp = await net.fetch(pathToFileURL(filePath).toString())
      return new Response(resp.body, { headers })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
