import { useEffect, useRef, useState } from 'react'

const SIZE = 110 // 放大镜边长（CSS px）
const SRC_SPAN = 22 // 采样原图区域（CSS px），22px → 11 格 × 10px
const INFO_H = 40

interface Props {
  image: HTMLImageElement
  cssW: number
  cssH: number
  x: number
  y: number
}

let probeCtx: CanvasRenderingContext2D | null = null

function pickColor(
  image: HTMLImageElement,
  cssW: number,
  cssH: number,
  x: number,
  y: number
): [number, number, number] {
  const ratio = image.naturalWidth / cssW
  if (!probeCtx) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    probeCtx = c.getContext('2d', { willReadFrequently: true })
  }
  const ctx = probeCtx!
  ctx.clearRect(0, 0, 1, 1)
  const nx = Math.min(cssW - 1, Math.max(0, x))
  const ny = Math.min(cssH - 1, Math.max(0, y))
  const sx = Math.min(Math.max(0, Math.floor(nx * ratio)), image.naturalWidth - 1)
  const sy = Math.min(Math.max(0, Math.floor(ny * ratio)), image.naturalHeight - 1)
  ctx.drawImage(image, sx, sy, 1, 1, 0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

export default function Magnifier({ image, cssW, cssH, x, y }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState<[number, number, number]>([0, 0, 0])

  useEffect(() => {
    if (x < 0 || y < 0 || x >= cssW || y >= cssH) return
    setColor(pickColor(image, cssW, cssH, x, y))
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    const ratio = image.naturalWidth / cssW
    const sx = (x - SRC_SPAN / 2) * ratio
    const sy = (y - SRC_SPAN / 2) * ratio
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.drawImage(
      image,
      sx,
      sy,
      SRC_SPAN * ratio,
      SRC_SPAN * ratio,
      0,
      0,
      SIZE,
      SIZE
    )
    // 网格线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 1
    for (let i = 1; i < 11; i++) {
      ctx.beginPath()
      ctx.moveTo(i * 10 + 0.5, 0)
      ctx.lineTo(i * 10 + 0.5, SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * 10 + 0.5)
      ctx.lineTo(SIZE, i * 10 + 0.5)
      ctx.stroke()
    }
    // 中心十字
    ctx.strokeStyle = '#FF4D4F'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(SIZE / 2 + 0.5, 0)
    ctx.lineTo(SIZE / 2 + 0.5, SIZE)
    ctx.moveTo(0, SIZE / 2 + 0.5)
    ctx.lineTo(SIZE, SIZE / 2 + 0.5)
    ctx.stroke()
  }, [image, cssW, cssH, x, y])

  // 跟随光标，靠近边缘时翻转，并保证不超出屏幕
  const flipH = x + 20 + SIZE > cssW
  const flipV = y + 20 + SIZE + INFO_H > cssH
  const rawLeft = flipH ? x - 20 - SIZE : x + 20
  const rawTop = flipV ? y - 20 - SIZE - INFO_H : y + 20
  const left = Math.max(4, Math.min(cssW - SIZE - 4, rawLeft))
  const top = Math.max(4, Math.min(cssH - SIZE - INFO_H - 4, rawTop))

  const hex = `#${color.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  const [r, g, b] = color

  return (
    <div className="magnifier" style={{ left, top }}>
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      <div className="magnifier-info">
        <span>
          X {Math.round(x)} Y {Math.round(y)}
        </span>
        <span className="magnifier-color">
          <i style={{ background: hex }} />
          {hex} · rgb({r},{g},{b})
        </span>
      </div>
    </div>
  )
}
