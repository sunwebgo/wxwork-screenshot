import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { join } from 'path'
import type { OverlayInfo, Rect } from '../shared/types'
import { IPC } from '../shared/types'
import {
  clearCaptureBuffers,
  hasCaptureBuffer,
  putCaptureBuffer
} from './protocol'
import { grabFramesFromService, initCaptureService, invalidateCaptureService, isCaptureServiceReady } from './capture-service'
import { captureWithGdi, initGdiCapture, isGdiCaptureReady, isGdiCaptureStarting } from './gdi-capture'
import { createPinWindow } from './pin-window'
import { copyImageToClipboard, saveImageDialog } from './export'

let capturing = false
/** 本轮抓屏产生的所有遮罩窗口 */
let overlayWindows: BrowserWindow[] = []
/** webContents.id → 该遮罩窗口对应的显示器 */
const overlayDisplays = new Map<number, Electron.Display>()
/** webContents.id → 冻结帧文件名 */
const overlayImageNames = new Map<number, string>()
/** 当前激活选区的遮罩窗口 displayId */
let activeDisplayId: number | null = null
/** 本轮编号，保证图片 URL 不会命中旧缓存 */
let captureSeq = 0
/** 遮罩迟迟没有加载完成时的兜底定时器 */
let readyWatchdog: NodeJS.Timeout | null = null
const readyWindows = new Set<number>()
/** 上一次截图结束时间：避免刚关掉遮罩就立刻再截图，把遮罩自己拍进去 */
let lastFinishAt = 0

const debug = process.env['WXSHOT_DEBUG'] === '1'
let captureStartedAt = 0
const mark = (msg: string, at = performance.now()): void => {
  if (debug) console.log(`[wxshot +${(at - captureStartedAt).toFixed(1)}ms] ${msg}`)
}

export function isCapturing(): boolean {
  return capturing
}

interface FrameData {
  display: Electron.Display
  index: number
  png: Buffer
}

/** 优先从常驻抓屏服务取当前帧；不可用时退回 desktopCapturer 单次抓屏 */
async function captureFrameData(displays: Electron.Display[], session: number): Promise<FrameData[]> {
  // 刚启动时抓屏助手可能还在初始化，短暂等它，避免第一次热键走 1–3 秒的慢回退
  if (!isGdiCaptureReady() && isGdiCaptureStarting()) {
    await Promise.race([
      initGdiCapture().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ])
  }
  // GDI 抓屏不包含鼠标指针，且常驻进程里只需几十毫秒
  const gdi = await captureWithGdi(displays, session)
  if (gdi && gdi.length === displays.length) {
    mark('GDI frames received')
    return gdi
  }

  if (isCaptureServiceReady()) {
    try {
      const frames = await grabFramesFromService()
      if (frames && frames.length === displays.length) {
        mark('service frames received')
        return displays.map((display, index) => {
          const frame = frames.find((f) => f.displayId === display.id)
          if (!frame) throw new Error(`missing frame for display ${display.id}`)
          return { display, index, png: Buffer.from(frame.pngBase64, 'base64') }
        })
      }
    } catch (err) {
      console.warn('capture service grab failed, falling back:', err)
      invalidateCaptureService()
    }
  }

  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH }
  })
  mark(`fallback getSources done, ${sources.length} sources`)
  if (!sources.length) throw new Error('no screen source')
  return displays.map((display, index) => {
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[index]
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(`no capture source for display ${display.id}`)
    }
    return { display, index, png: source.thumbnail.toPNG() }
  })
}

function loadOverlay(win: BrowserWindow, index: number): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    return win.loadURL(`${devUrl}/overlay.html?d=${index}`)
  }
  return win.loadFile(join(__dirname, '../renderer/overlay.html'), { search: `d=${index}` })
}

export async function startCapture(): Promise<void> {
  if (capturing) return
  capturing = true
  captureStartedAt = performance.now()
  mark('startCapture')
  try {
    closeOverlays()
    activeDisplayId = null
    readyWindows.clear()

    // 刚关闭遮罩后立即可再次按热键时，等 100ms 让抓屏流吐出新的一帧
    const sinceFinish = Date.now() - lastFinishAt
    if (sinceFinish < 100) await new Promise((r) => setTimeout(r, 100 - sinceFinish))

    const displays = screen.getAllDisplays()
    const session = ++captureSeq
    const frames = await captureFrameData(displays, session)
    mark('frames ready')

    const created: BrowserWindow[] = []
    const loads: Promise<void>[] = []
    for (const frame of frames) {
      const { display, index, png } = frame
      const name = `cap-${session}-${display.id}.png`
      putCaptureBuffer(name, png)

      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        show: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        enableLargerThanScreen: true,
        alwaysOnTop: true,
        hasShadow: false,
        roundedCorners: false,
        backgroundColor: '#000000',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      })
      // 实测 Windows 会把新建窗口的高度限制在工作区（864→816），
      // 必须在创建后再 setBounds 一次，遮罩才能覆盖任务栏所在的整块屏幕。
      win.setBounds(display.bounds)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setMenu(null)
      overlayDisplays.set(win.webContents.id, display)
      overlayImageNames.set(win.webContents.id, name)

      // Esc 兜底：渲染层键盘事件之外再拦一层
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          finishCapture('esc-in-overlay')
        }
      })

      created.push(win)
      loads.push(loadOverlay(win, index).then(() => mark(`display ${display.id} window loaded`)))
    }

    overlayWindows = created
    readyWatchdog = setTimeout(() => {
      if (capturing && readyWindows.size < overlayWindows.length) {
        console.warn('overlay ready timeout, closing capture')
        finishCapture('overlay-ready-timeout')
      }
    }, 12000)

    await Promise.all(loads)
    mark('all windows loaded')
    if (!isCaptureServiceReady() && !isGdiCaptureReady()) {
      // GDI 和视频流都不可用才建立常驻视频流，避免平时多占一份屏幕捕获
      void initCaptureService().catch(() => {})
    }
  } catch (err) {
    console.error('startCapture failed:', err)
    finishCapture('start-error')
  }
}

export function finishCapture(reason = 'unknown'): void {
  if (debug) console.log(`[wxshot] finishCapture reason=${reason} capturing=${capturing}`)
  lastFinishAt = Date.now()
  if (readyWatchdog) {
    clearTimeout(readyWatchdog)
    readyWatchdog = null
  }
  readyWindows.clear()
  closeOverlays()
  clearCaptureBuffers()
  activeDisplayId = null
  capturing = false
}

function closeOverlays(): void {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  overlayWindows = []
  overlayDisplays.clear()
  overlayImageNames.clear()
}

export function registerOverlayIpc(): void {
  ipcMain.handle(IPC.OVERLAY_INIT, (e): OverlayInfo | null => {
    const display = overlayDisplays.get(e.sender.id) ?? screen.getPrimaryDisplay()
    const name = overlayImageNames.get(e.sender.id)
    if (!name || !hasCaptureBuffer(name)) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const content = win && !win.isDestroyed() ? win.getContentBounds() : null
    const index = screen.getAllDisplays().findIndex((d) => d.id === display.id)
    return {
      displayId: display.id,
      index: index >= 0 ? index : 0,
      total: overlayWindows.length,
      bounds: {
        x: 0,
        y: 0,
        width: content?.width ?? display.bounds.width,
        height: content?.height ?? display.bounds.height
      },
      scaleFactor: display.scaleFactor,
      imageUrl: `wxshot://cap/${name}`
    }
  })

  ipcMain.on(IPC.OVERLAY_READY, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    mark(`OVERLAY_READY bounds=${JSON.stringify(win.getBounds())}`)
    readyWindows.add(win.id)
    win.showInactive()
    // 只让光标所在屏幕的遮罩窗口获得键盘焦点，避免多屏时互相抢焦点
    const display = overlayDisplays.get(e.sender.id)
    const cursor = screen.getCursorScreenPoint()
    const activeDisplay = screen.getDisplayNearestPoint(cursor)
    if (display && display.id === activeDisplay.id) win.focus()
    if (readyWindows.size >= overlayWindows.length && readyWatchdog) {
      clearTimeout(readyWatchdog)
      readyWatchdog = null
    }
  })

  ipcMain.on(IPC.OVERLAY_ACTIVATE, (e, displayId: number) => {
    if (activeDisplayId === displayId) return
    activeDisplayId = displayId
    for (const win of overlayWindows) {
      if (!win.isDestroyed() && win.webContents !== e.sender) {
        win.webContents.send(IPC.OVERLAY_DEACTIVATE)
      }
    }
  })

  ipcMain.on(IPC.OVERLAY_DEACTIVATE, () => {
    /* 渲染层接收通道，主进程侧无逻辑 */
  })

  ipcMain.handle(IPC.CAPTURE_CANCEL, () => {
    finishCapture('ipc-cancel')
    return true
  })

  ipcMain.handle(IPC.CAPTURE_CONFIRM_COPY, (_e, dataUrl: string) => {
    const ok = copyImageToClipboard(dataUrl)
    if (ok) finishCapture('confirm-copy')
    return ok
  })

  ipcMain.handle(IPC.CAPTURE_CONFIRM_SAVE, async (_e, dataUrl: string) => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    const saved = await saveImageDialog(win, dataUrl)
    // 用户在保存对话框点取消时保留截图界面，方便继续编辑或另选操作
    if (saved) finishCapture('confirm-save')
    return saved
  })

  ipcMain.handle(IPC.CAPTURE_CONFIRM_PIN, (_e, dataUrl: string, rect: Rect) => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    // 贴图出现在截取区域所在的屏幕位置
    const bounds = win?.getBounds()
    createPinWindow(dataUrl, {
      x: (bounds?.x ?? 0) + Math.round(rect.x),
      y: (bounds?.y ?? 0) + Math.round(rect.y),
      width: Math.max(40, Math.round(rect.width)),
      height: Math.max(40, Math.round(rect.height))
    })
    finishCapture('confirm-pin')
    return true
  })
}
