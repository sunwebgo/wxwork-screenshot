import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { join } from 'path'
import type { CaptureFrame, CaptureServiceInit, CaptureServiceReadyInfo } from '../shared/types'
import { IPC } from '../shared/types'

interface PendingGrab {
  resolve: (frames: CaptureFrame[]) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

let serviceWindow: BrowserWindow | null = null
let serviceReady = false
let serviceDisplays: Electron.Display[] = []
let readyWaiter: ((infos: CaptureServiceReadyInfo[]) => void) | null = null
let initPromise: Promise<void> | null = null
let initFailedAt = 0
let grabSeq = 0
const pendingGrabs = new Map<number, PendingGrab>()

const debug = process.env['WXSHOT_DEBUG'] === '1'

function sameDisplays(a: Electron.Display[], b: Electron.Display[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d, i) => {
    const o = b[i]
    return (
      o &&
      d.id === o.id &&
      d.bounds.x === o.bounds.x &&
      d.bounds.y === o.bounds.y &&
      d.bounds.width === o.bounds.width &&
      d.bounds.height === o.bounds.height &&
      d.scaleFactor === o.scaleFactor
    )
  })
}

function rejectPending(reason: string): void {
  for (const [, p] of pendingGrabs) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pendingGrabs.clear()
}

export function isCaptureServiceReady(): boolean {
  return serviceReady && !!serviceWindow && !serviceWindow.isDestroyed()
}

export function invalidateCaptureService(): void {
  serviceReady = false
  readyWaiter = null
  rejectPending('capture service restarted')
  if (serviceWindow && !serviceWindow.isDestroyed()) serviceWindow.destroy()
  serviceWindow = null
  serviceDisplays = []
}

export function destroyCaptureService(): void {
  invalidateCaptureService()
}

function waitForReady(timeoutMs: number): Promise<CaptureServiceReadyInfo[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiter = null
      reject(new Error('capture service ready timeout'))
    }, timeoutMs)
    readyWaiter = (infos) => {
      clearTimeout(timer)
      readyWaiter = null
      resolve(infos)
    }
  })
}

async function doInit(): Promise<void> {
  invalidateCaptureService()
  const displays = screen.getAllDisplays()
  const t0 = performance.now()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 }
  })
  if (debug) console.log(`[wxshot] capture-service getSources ${(performance.now() - t0).toFixed(0)}ms`)

  const ordered: Electron.DesktopCapturerSource[] = []
  for (let i = 0; i < displays.length; i++) {
    const display = displays[i]
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[i]
    if (!source) throw new Error(`no desktop source for display ${display.id}`)
    ordered.push(source)
  }

  const win = new BrowserWindow({
    show: false,
    width: 360,
    height: 200,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.setMenu(null)
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('capture service renderer gone:', details.reason)
    invalidateCaptureService()
  })
  serviceWindow = win
  await win.loadFile(join(__dirname, '../renderer/capture.html'))
  // 让页面脚本先注册 onInit 监听
  await new Promise((r) => setTimeout(r, 60))

  const init: CaptureServiceInit = {
    displays: displays.map((d, i) => ({
      id: d.id,
      width: Math.round(d.bounds.width * d.scaleFactor),
      height: Math.round(d.bounds.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
      sourceId: ordered[i].id
    }))
  }
  const ready = waitForReady(15000)
  win.webContents.send(IPC.CAPTURE_SERVICE_INIT, init)
  const infos = await ready

  const failed = infos.filter((i) => !i.ok)
  if (failed.length) {
    throw new Error(`capture stream failed for display ${failed.map((f) => f.displayId).join(',')}: ${failed.map((f) => f.error).filter(Boolean).join('; ')}`)
  }
  if (infos.length !== displays.length) {
    throw new Error(`capture service ready ${infos.length}/${displays.length}`)
  }
  serviceDisplays = displays
  serviceReady = true
  if (debug) {
    console.log(
      `[wxshot] capture-service ready ${JSON.stringify(infos.map((i) => ({ id: i.displayId, w: i.width, h: i.height })))}`
    )
  }
}

export async function initCaptureService(): Promise<void> {
  if (isCaptureServiceReady() && sameDisplays(serviceDisplays, screen.getAllDisplays())) return
  if (initPromise) return initPromise
  if (Date.now() - initFailedAt < 5000) return
  initPromise = doInit()
    .catch((err) => {
      initFailedAt = Date.now()
      console.warn('capture service init failed:', err)
      invalidateCaptureService()
      throw err
    })
    .finally(() => {
      initPromise = null
    })
  return initPromise
}

/** 常驻服务不可用时返回 null，由调用方回退到 desktopCapturer 单次抓屏 */
export async function grabFramesFromService(): Promise<CaptureFrame[] | null> {
  if (!isCaptureServiceReady()) return null
  if (!sameDisplays(serviceDisplays, screen.getAllDisplays())) {
    invalidateCaptureService()
    return null
  }
  const win = serviceWindow
  if (!win || win.isDestroyed()) return null
  const requestId = ++grabSeq
  return new Promise<CaptureFrame[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingGrabs.delete(requestId)
      reject(new Error('capture service grab timeout'))
    }, 3000)
    pendingGrabs.set(requestId, { resolve, reject, timer })
    win.webContents.send(IPC.CAPTURE_SERVICE_GRAB, requestId)
  })
}

export function registerCaptureServiceIpc(): void {
  ipcMain.on(IPC.CAPTURE_SERVICE_READY, (_e, infos: CaptureServiceReadyInfo[]) => {
    if (readyWaiter) readyWaiter(infos)
  })

  ipcMain.on(IPC.CAPTURE_SERVICE_FRAMES, (_e, requestId: number, frames: CaptureFrame[]) => {
    const pending = pendingGrabs.get(requestId)
    if (!pending) return
    pendingGrabs.delete(requestId)
    clearTimeout(pending.timer)
    const expected = serviceDisplays.length
    if (!Array.isArray(frames) || frames.length < expected) {
      pending.reject(new Error(`capture frames incomplete: ${frames?.length ?? 0}/${expected}`))
      return
    }
    const byId = new Map(frames.map((f) => [f.displayId, f]))
    const ordered: CaptureFrame[] = []
    for (const display of serviceDisplays) {
      const frame = byId.get(display.id)
      if (!frame || !frame.pngBase64) {
        pending.reject(new Error(`missing frame for display ${display.id}`))
        return
      }
      ordered.push(frame)
    }
    pending.resolve(ordered)
  })

  const invalidate = (): void => {
    console.warn('display configuration changed, restarting capture service')
    invalidateCaptureService()
  }
  screen.on('display-added', invalidate)
  screen.on('display-removed', invalidate)
  screen.on('display-metrics-changed', invalidate)
}
