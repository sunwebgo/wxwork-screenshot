export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 主进程返回给遮罩窗口的抓屏信息 */
export interface OverlayInfo {
  displayId: number
  index: number
  total: number
  /** 该显示器的边界（CSS 像素） */
  bounds: Rect
  scaleFactor: number
  /** 冻结帧图片地址（wxshot:// 协议） */
  imageUrl: string
}

export interface PinInitInfo {
  dataUrl: string
  bounds: Rect
  onTop: boolean
}

/** 常驻抓屏服务的单帧数据 */
export interface CaptureFrame {
  displayId: number
  width: number
  height: number
  /** PNG 的 base64（不含 data:image/png;base64, 前缀） */
  pngBase64: string
}

/** 常驻抓屏服务初始化信息 */
export interface CaptureServiceInit {
  displays: Array<{ id: number; width: number; height: number; scaleFactor: number; sourceId: string }>
}

export interface CaptureServiceReadyInfo {
  displayId: number
  width: number
  height: number
  ok: boolean
  error?: string
}

/** IPC 通道名 */
export const IPC = {
  OVERLAY_INIT: 'overlay:init',
  OVERLAY_READY: 'overlay:ready',
  OVERLAY_ACTIVATE: 'overlay:activate',
  /** 其他遮罩窗口被激活时，广播让本窗口退化为纯遮罩 */
  OVERLAY_DEACTIVATE: 'overlay:deactivate',
  CAPTURE_CANCEL: 'capture:cancel',
  CAPTURE_CONFIRM_COPY: 'capture:confirm:copy',
  CAPTURE_CONFIRM_SAVE: 'capture:confirm:save',
  CAPTURE_CONFIRM_PIN: 'capture:confirm:pin',
  OCR_EXTRACT: 'ocr:extract',

  CAPTURE_SERVICE_INIT: 'cap-svc:init',
  CAPTURE_SERVICE_READY: 'cap-svc:ready',
  CAPTURE_SERVICE_GRAB: 'cap-svc:grab',
  CAPTURE_SERVICE_FRAMES: 'cap-svc:frames',

  PIN_INIT: 'pin:init',
  PIN_GET_BOUNDS: 'pin:get-bounds',
  PIN_SET_POSITION: 'pin:set-position',
  PIN_SET_SIZE: 'pin:set-size',
  PIN_RESIZE_BY: 'pin:resize-by',
  PIN_TOGGLE_TOP: 'pin:toggle-top',
  PIN_SHOW_MENU: 'pin:show-menu',
  PIN_CLOSE: 'pin:close',
  PIN_COPY: 'pin:copy',
  PIN_SAVE: 'pin:save',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text'
} as const

export const CAPTURE_SCHEME = 'wxshot'
