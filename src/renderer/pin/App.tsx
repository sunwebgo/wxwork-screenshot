import { useEffect, useRef, useState } from 'react'
import type { Rect } from '../../shared/types'

interface Size {
  width: number
  height: number
}

const MIN_SIZE = 40
const MAX_SIZE = 8000

export default function PinApp() {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const aspectRef = useRef(1)
  const boundsRef = useRef<Rect | null>(null)
  const sizeRef = useRef<Size>({ width: 0, height: 0 })
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null)
  const rafRef = useRef(0)
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void window.api.getPinInfo().then((info) => {
      if (!info) return
      setDataUrl(info.dataUrl)
      boundsRef.current = { ...info.bounds }
      sizeRef.current = { width: info.bounds.width, height: info.bounds.height }
      const im = new Image()
      im.onload = () => {
        aspectRef.current = im.naturalHeight / Math.max(1, im.naturalWidth)
      }
      im.src = info.dataUrl
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        window.api.closePin()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const flushPosition = (): void => {
    rafRef.current = 0
    const p = pendingPosRef.current
    pendingPosRef.current = null
    if (p) {
      const size = sizeRef.current
      window.api.setPinPosition(p.x, p.y, size.width, size.height)
    }
  }

  const queuePosition = (x: number, y: number): void => {
    pendingPosRef.current = { x, y }
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushPosition)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const b = boundsRef.current
    if (!b) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.screenX, startY: e.screenY, winX: b.x, winY: b.y }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    const b = boundsRef.current
    if (!d || !b) return
    // pointer 事件与 BrowserWindow 坐标同为 DIP（CSS 像素）
    const nextX = Math.round(d.winX + (e.screenX - d.startX))
    const nextY = Math.round(d.winY + (e.screenY - d.startY))
    boundsRef.current = { ...b, x: nextX, y: nextY }
    queuePosition(nextX, nextY)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null
    setDragging(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      flushPosition()
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // 以实际窗口尺寸为准，避免 DIP 取整后下一次拖动仍用旧尺寸
    void window.api.getPinBounds().then((b) => {
      if (!b) return
      boundsRef.current = { ...b }
      sizeRef.current = { width: b.width, height: b.height }
    })
  }

  // 滚轮缩放：只改窗口大小，位置由主进程按中心点保持
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const b = boundsRef.current
    const size = sizeRef.current
    if (!b || !size.width) return
    const factor = Math.exp(-e.deltaY * 0.0015)
    let width = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size.width * factor)))
    let height = Math.round(width * aspectRef.current)
    if (height < MIN_SIZE) {
      height = MIN_SIZE
      width = Math.round(height / Math.max(0.01, aspectRef.current))
    }
    if (height > MAX_SIZE) {
      height = MAX_SIZE
      width = Math.round(height / Math.max(0.01, aspectRef.current))
    }
    if (width === size.width && height === size.height) return
    boundsRef.current = {
      x: Math.round(b.x + (b.width - width) / 2),
      y: Math.round(b.y + (b.height - height) / 2),
      width,
      height
    }
    sizeRef.current = { width, height }
    window.api.setPinSize(width, height)
  }

  return (
    <div
      className={`pin-root${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => window.api.closePin()}
      onWheel={onWheel}
      onContextMenu={(e) => {
        e.preventDefault()
        window.api.showPinMenu(e.clientX, e.clientY)
      }}
    >
      {dataUrl && <img src={dataUrl} draggable={false} alt="" />}
      <button
        className="pin-close"
        title="关闭贴图 (Esc)"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          window.api.closePin()
        }}
      >
        ×
      </button>
    </div>
  )
}
