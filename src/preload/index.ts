import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  CaptureFrame,
  CaptureServiceInit,
  CaptureServiceReadyInfo,
  OverlayInfo,
  PinInitInfo,
  Rect
} from '../shared/types'
import { IPC } from '../shared/types'

export interface OcrResult {
  ok: boolean
  text?: string
  error?: string
}

const api = {
  // ---- 截图遮罩 ----
  getOverlayInfo: (displayIndex: number): Promise<OverlayInfo | null> =>
    ipcRenderer.invoke(IPC.OVERLAY_INIT, displayIndex),
  notifyOverlayReady: (): void => ipcRenderer.send(IPC.OVERLAY_READY),
  activate: (displayId: number): void => ipcRenderer.send(IPC.OVERLAY_ACTIVATE, displayId),
  onDeactivate: (cb: () => void): (() => void) => {
    const handler = (_e: IpcRendererEvent): void => cb()
    ipcRenderer.on(IPC.OVERLAY_DEACTIVATE, handler)
    return () => ipcRenderer.removeListener(IPC.OVERLAY_DEACTIVATE, handler)
  },
  cancel: (): Promise<boolean> => ipcRenderer.invoke(IPC.CAPTURE_CANCEL),
  confirmCopy: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CAPTURE_CONFIRM_COPY, dataUrl),
  confirmSave: (dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.CAPTURE_CONFIRM_SAVE, dataUrl),
  confirmPin: (dataUrl: string, rect: Rect): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CAPTURE_CONFIRM_PIN, dataUrl, rect),
  ocr: (dataUrl: string): Promise<OcrResult> => ipcRenderer.invoke(IPC.OCR_EXTRACT, dataUrl),

  // ---- 常驻抓屏服务（隐藏窗口） ----
  captureService: {
    onInit: (cb: (init: CaptureServiceInit) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, init: CaptureServiceInit): void => cb(init)
      ipcRenderer.on(IPC.CAPTURE_SERVICE_INIT, handler)
      return () => ipcRenderer.removeListener(IPC.CAPTURE_SERVICE_INIT, handler)
    },
    onGrab: (cb: (requestId: number) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, requestId: number): void => cb(requestId)
      ipcRenderer.on(IPC.CAPTURE_SERVICE_GRAB, handler)
      return () => ipcRenderer.removeListener(IPC.CAPTURE_SERVICE_GRAB, handler)
    },
    notifyReady: (infos: CaptureServiceReadyInfo[]): void =>
      ipcRenderer.send(IPC.CAPTURE_SERVICE_READY, infos),
    sendFrames: (requestId: number, frames: CaptureFrame[]): void =>
      ipcRenderer.send(IPC.CAPTURE_SERVICE_FRAMES, requestId, frames)
  },

  // ---- 贴图窗口 ----
  getPinInfo: (): Promise<PinInitInfo | null> => ipcRenderer.invoke(IPC.PIN_INIT),
  getPinBounds: (): Promise<{ x: number; y: number; width: number; height: number } | null> =>
    ipcRenderer.invoke(IPC.PIN_GET_BOUNDS),
  setPinPosition: (x: number, y: number, width: number, height: number): void =>
    ipcRenderer.send(IPC.PIN_SET_POSITION, x, y, width, height),
  setPinSize: (width: number, height: number): void =>
    ipcRenderer.send(IPC.PIN_SET_SIZE, width, height),
  resizePinBy: (dw: number, dh: number): void => ipcRenderer.send(IPC.PIN_RESIZE_BY, dw, dh),
  togglePinTop: (): Promise<boolean> => ipcRenderer.invoke(IPC.PIN_TOGGLE_TOP),
  showPinMenu: (x: number, y: number): void => ipcRenderer.send(IPC.PIN_SHOW_MENU, x, y),
  closePin: (): void => ipcRenderer.send(IPC.PIN_CLOSE),
  copyPin: (): void => ipcRenderer.send(IPC.PIN_COPY),

  writeClipboardText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
