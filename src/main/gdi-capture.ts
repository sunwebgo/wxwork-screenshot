import { app, screen } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createInterface, type Interface } from 'readline'
import { join } from 'path'
import { readFile, unlink } from 'fs/promises'
import { ensureCaptureDir } from './protocol'

interface ShotResult {
  display: Electron.Display
  index: number
  png: Buffer
}

interface Pending {
  resolve: () => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const debug = process.env['WXSHOT_DEBUG'] === '1'

let child: ChildProcess | null = null
let rl: Interface | null = null
let helperReady = false
let startPromise: Promise<void> | null = null
let failedAt = 0
let shuttingDown = false
let seq = 0
const pending = new Map<number, Pending>()

function resourcesPath(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}

function rejectAll(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

function startHelper(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = join(resourcesPath(), 'screen-capture.ps1')
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    child = proc
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      helperReady = false
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      reject(new Error('screen-capture helper start timeout'))
    }, 10000)

    rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      const text = line.trim()
      if (text === 'READY') {
        helperReady = true
        if (debug) console.log('[wxshot] GDI capture helper ready')
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve()
        }
        return
      }
      const m = /^DONE (\d+) ([01])$/.exec(text)
      if (!m) return
      const id = Number(m[1])
      const ok = m[2] === '1'
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      clearTimeout(p.timer)
      if (ok) p.resolve()
      else p.reject(new Error(`screen-capture helper failed for request ${id}`))
    })

    proc.stderr?.on('data', (data) => {
      console.warn('[screen-capture]', data.toString().trim())
    })
    proc.stdin?.on('error', () => {
      /* helper 退出时的 EPIPE，由 exit 事件统一处理 */
    })
    proc.on('exit', (code) => {
      helperReady = false
      child = null
      rl?.close()
      rl = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error(`screen-capture helper exited (${code})`))
      }
      rejectAll('screen-capture helper exited')
      if (!shuttingDown) {
        setTimeout(() => {
          if (!shuttingDown) void initGdiCapture().catch(() => {})
        }, 3000).unref()
      }
    })
    proc.on('error', (err) => {
      helperReady = false
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}

export function isGdiCaptureReady(): boolean {
  return helperReady && !!child && !child.killed
}

export function isGdiCaptureStarting(): boolean {
  return startPromise !== null
}

export async function initGdiCapture(): Promise<void> {
  if (isGdiCaptureReady()) return
  if (startPromise) return startPromise
  if (Date.now() - failedAt < 5000) return
  startPromise = startHelper()
    .catch((err) => {
      failedAt = Date.now()
      helperReady = false
      if (child && !child.killed) {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
      child = null
      throw err
    })
    .finally(() => {
      startPromise = null
    })
  return startPromise
}

/**
 * 用系统 GDI BitBlt 抓屏：不包含鼠标指针，且比每次重新初始化桌面捕获管线快。
 * 失败时返回 null，调用方回退到视频流/desktopCapturer。
 */
export async function captureWithGdi(
  displays: Electron.Display[],
  session: number
): Promise<ShotResult[] | null> {
  if (!isGdiCaptureReady() || !child || !child.stdin) return null
  const dir = ensureCaptureDir()
  const shots = displays.map((display, index) => {
    // 按显示器自己的 DPI 把 DIP 原点转换成物理像素，混合 DPI/负坐标下也正确
    const origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
    const width = Math.round(display.bounds.width * display.scaleFactor)
    const height = Math.round(display.bounds.height * display.scaleFactor)
    const file = join(dir, `gdi-${session}-${display.id}.png`)
    return {
      display,
      index,
      file,
      width,
      height,
      x: origin.x,
      y: origin.y
    }
  })
  const id = ++seq
  const command = JSON.stringify({
    id,
    shots: shots.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height, file: s.file }))
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('screen-capture helper timeout'))
      }, 4000)
      pending.set(id, { resolve, reject, timer })
      child!.stdin!.write(`${command}\n`, 'utf8')
    })
  } catch (err) {
    console.warn('GDI capture failed:', err)
    return null
  }

  const result: ShotResult[] = []
  try {
    for (const shot of shots) {
      const png = await readFile(shot.file)
      result.push({ display: shot.display, index: shot.index, png })
    }
    if (debug) console.log(`[wxshot] GDI capture ${result.length} display(s)`)
    return result
  } catch (err) {
    console.warn('GDI capture file read failed:', err)
    return null
  } finally {
    for (const shot of shots) {
      void unlink(shot.file).catch(() => {})
    }
  }
}

export function destroyGdiCapture(): void {
  shuttingDown = true
  helperReady = false
  rejectAll('screen-capture helper destroyed')
  const proc = child
  child = null
  rl?.close()
  rl = null
  if (proc && !proc.killed) {
    try {
      proc.stdin?.write('QUIT\n')
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
      }
    }, 300).unref()
  }
}
