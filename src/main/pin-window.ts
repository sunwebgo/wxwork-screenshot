import { BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, screen } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import type { PinInitInfo, Rect } from '../shared/types'
import { IPC } from '../shared/types'

interface PinEntry {
  win: BrowserWindow
  dataUrl: string
  image: Electron.NativeImage
  onTop: boolean
}

const pins = new Map<number, PinEntry>()

function localStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function ensureImageExtension(filePath: string): string {
  return /\.[A-Za-z0-9]+$/.test(filePath) ? filePath : `${filePath}.png`
}

function notifyCopied(): void {
  if (Notification.isSupported()) {
    new Notification({ title: '已复制', body: '图片已复制到剪贴板', silent: true }).show()
  }
}

function showPinMenu(win: BrowserWindow, entry: PinEntry): void {
  if (win.isDestroyed()) return
  Menu.buildFromTemplate([
    {
      label: entry.onTop ? '取消置顶' : '置顶贴图',
      click: () => {
        entry.onTop = !entry.onTop
        win.setAlwaysOnTop(entry.onTop, 'screen-saver')
      }
    },
    { type: 'separator' },
    {
      label: '复制图片',
      click: () => {
        clipboard.writeImage(entry.image)
        notifyCopied()
      }
    },
    {
      label: '保存图片',
      click: async () => {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '保存贴图',
          defaultPath: `贴图_${localStamp()}.png`,
          filters: [
            { name: 'PNG 图片', extensions: ['png'] },
            { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }
          ]
        })
        if (canceled || !filePath) return
        const target = ensureImageExtension(filePath)
        const isJpg = /\.jpe?g$/i.test(target)
        try {
          await writeFile(target, isJpg ? entry.image.toJPEG(92) : entry.image.toPNG())
          if (Notification.isSupported()) {
            new Notification({ title: '保存成功', body: target, silent: true }).show()
          }
        } catch (err) {
          dialog.showMessageBox(win, {
            type: 'error',
            title: '保存失败',
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
    },
    { type: 'separator' },
    { label: '关闭贴图', click: () => win.close() }
    // 不传 x/y，让原生菜单直接出现在鼠标位置：DPI 缩放、多屏负坐标下都不会跑偏
  ]).popup({ window: win })
}

export function createPinWindow(dataUrl: string, rect: Rect): void {
  const win = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: Math.max(40, Math.ceil(rect.width)),
    height: Math.max(40, Math.ceil(rect.height)),
    frame: false,
    show: false,
    skipTaskbar: true,
    // 贴图缩放由滚轮自行控制；开启原生 resizable 会在无边框窗口四周留下
    // 看不见的拖拽缩放边框，用户从边缘拖动时会误触缩放（表现为越拖越大）。
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: false,
    alwaysOnTop: true,
    hasShadow: true,
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
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenu(null)
  win.setSkipTaskbar(true)

  const entry: PinEntry = {
    win,
    dataUrl,
    image: nativeImage.createFromDataURL(dataUrl),
    onTop: true
  }
  pins.set(win.id, entry)
  win.on('closed', () => pins.delete(win.id))

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.key === 'Delete')) {
      if (!win.isDestroyed()) win.close()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/pin.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/pin.html'))
  }
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.webContents.on('did-fail-load', () => {
    if (!win.isDestroyed()) win.close()
  })
}

export function closeAllPins(): void {
  for (const { win } of pins.values()) {
    if (!win.isDestroyed()) win.close()
  }
  pins.clear()
}

export function registerPinIpc(): void {
  ipcMain.handle(IPC.PIN_INIT, (e): PinInitInfo | null => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const entry = win ? pins.get(win.id) : undefined
    return entry && win ? { dataUrl: entry.dataUrl, bounds: win.getBounds(), onTop: entry.onTop } : null
  })

  ipcMain.handle(IPC.CLIPBOARD_WRITE_TEXT, (_e, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : '')
    return true
  })

  ipcMain.on(IPC.PIN_SET_POSITION, (e, x: number, y: number, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const targetW = Math.max(40, Math.min(8000, Math.round(width || b.width)))
    const targetH = Math.max(40, Math.min(8000, Math.round(height || b.height)))
    // 把位置对齐到物理像素网格：未对齐时 Windows 每次 SetWindowPos 会做一次
    // DIP→物理→DIP 取整，窗口尺寸会逐次 +1px（表现为拖动时慢慢放大）。
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) })
    const sf = display.scaleFactor || 1
    const ax = Math.round(x * sf) / sf
    const ay = Math.round(y * sf) / sf
    win.setBounds({ x: ax, y: ay, width: targetW, height: targetH }, false)
    if (process.env['WXSHOT_DEBUG'] === '1') {
      const a = win.getBounds()
      console.log(`[pin-move] req=${ax},${ay} target=${targetW}x${targetH} after=${a.width}x${a.height} pos=${a.x},${a.y}`)
    }
  })

  ipcMain.handle(IPC.PIN_GET_BOUNDS, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win && !win.isDestroyed() ? win.getBounds() : null
  })

  ipcMain.on(IPC.PIN_SET_SIZE, (e, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const w = Math.max(40, Math.min(8000, Math.round(width)))
    const h = Math.max(40, Math.min(8000, Math.round(height)))
    win.setBounds({
      x: Math.round(b.x + (b.width - w) / 2),
      y: Math.round(b.y + (b.height - h) / 2),
      width: w,
      height: h
    })
  })

  ipcMain.on(IPC.PIN_RESIZE_BY, (e, dw: number, dh: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const w = Math.max(40, Math.min(8000, b.width + dw))
    const h = Math.max(40, Math.min(8000, b.height + dh))
    // 以窗口中心为基准缩放
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    win.setBounds({
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      width: Math.round(w),
      height: Math.round(h)
    })
  })

  ipcMain.handle(IPC.PIN_TOGGLE_TOP, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const entry = win ? pins.get(win.id) : undefined
    if (!win || !entry) return false
    entry.onTop = !entry.onTop
    win.setAlwaysOnTop(entry.onTop, 'screen-saver')
    return entry.onTop
  })

  ipcMain.on(IPC.PIN_SHOW_MENU, (e, _x: number, _y: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const entry = win ? pins.get(win.id) : undefined
    if (win && entry) showPinMenu(win, entry)
  })

  ipcMain.on(IPC.PIN_CLOSE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && !win.isDestroyed()) win.close()
  })

  ipcMain.on(IPC.PIN_COPY, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const entry = win ? pins.get(win.id) : undefined
    if (entry) {
      clipboard.writeImage(entry.image)
      notifyCopied()
    }
  })

  ipcMain.on(IPC.PIN_SAVE, () => {
    /* 贴图保存走右键菜单，此通道预留 */
  })
}
