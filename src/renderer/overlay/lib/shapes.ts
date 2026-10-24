export type ToolKind = 'rect' | 'ellipse' | 'arrow' | 'brush' | 'mosaic' | 'text' | 'number'

interface BaseShape {
  id: number
  kind: ToolKind
  color: string
  lineWidth: number
}

export interface RectShape extends BaseShape {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
}

export interface EllipseShape extends BaseShape {
  kind: 'ellipse'
  x: number
  y: number
  w: number
  h: number
}

export interface ArrowShape extends BaseShape {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Point {
  x: number
  y: number
}

export interface BrushShape extends BaseShape {
  kind: 'brush'
  points: Point[]
}

export interface MosaicShape extends BaseShape {
  kind: 'mosaic'
  points: Point[]
}

export interface TextShape extends BaseShape {
  kind: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export interface NumberShape extends BaseShape {
  kind: 'number'
  x: number
  y: number
  n: number
}

export type Shape =
  | RectShape
  | EllipseShape
  | ArrowShape
  | BrushShape
  | MosaicShape
  | TextShape
  | NumberShape

/** 复用临时画布（马赛克合成用） */
let tmpCanvas: HTMLCanvasElement | null = null

function getTmpCtx(w: number, h: number): CanvasRenderingContext2D {
  if (!tmpCanvas) tmpCanvas = document.createElement('canvas')
  if (tmpCanvas.width !== w || tmpCanvas.height !== h) {
    tmpCanvas.width = w
    tmpCanvas.height = h
  } else {
    tmpCanvas.getContext('2d')!.clearRect(0, 0, w, h)
  }
  return tmpCanvas.getContext('2d')!
}

function nextPointPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
}

/** 绘制单个图形；坐标均为 CSS 像素（调用方已处理缩放） */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  mosaicCanvas: HTMLCanvasElement | null,
  viewportW: number,
  viewportH: number
): void {
  ctx.save()
  ctx.strokeStyle = shape.color
  ctx.fillStyle = shape.color
  ctx.lineWidth = shape.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (shape.kind) {
    case 'rect': {
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h)
      break
    }
    case 'ellipse': {
      ctx.beginPath()
      ctx.ellipse(
        shape.x + shape.w / 2,
        shape.y + shape.h / 2,
        Math.abs(shape.w / 2),
        Math.abs(shape.h / 2),
        0,
        0,
        Math.PI * 2
      )
      ctx.stroke()
      break
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const headLen = Math.max(12, shape.lineWidth * 4)
      const shaftEndX = shape.x2 - Math.cos(angle) * headLen * 0.7
      const shaftEndY = shape.y2 - Math.sin(angle) * headLen * 0.7
      ctx.beginPath()
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shaftEndX, shaftEndY)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(shape.x2, shape.y2)
      ctx.lineTo(
        shape.x2 - headLen * Math.cos(angle - Math.PI / 7),
        shape.y2 - headLen * Math.sin(angle - Math.PI / 7)
      )
      ctx.lineTo(
        shape.x2 - headLen * Math.cos(angle + Math.PI / 7),
        shape.y2 - headLen * Math.sin(angle + Math.PI / 7)
      )
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'brush': {
      nextPointPath(ctx, shape.points)
      ctx.stroke()
      break
    }
    case 'mosaic': {
      if (!mosaicCanvas) break
      const tctx = getTmpCtx(viewportW, viewportH)
      tctx.save()
      tctx.strokeStyle = '#000'
      tctx.lineWidth = shape.lineWidth * 3 + 6
      tctx.lineCap = 'round'
      tctx.lineJoin = 'round'
      nextPointPath(tctx, shape.points)
      tctx.stroke()
      tctx.globalCompositeOperation = 'source-in'
      tctx.drawImage(mosaicCanvas, 0, 0, viewportW, viewportH)
      tctx.restore()
      ctx.drawImage(tmpCanvas!, 0, 0)
      break
    }
    case 'text': {
      ctx.font = `${shape.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
      ctx.textBaseline = 'top'
      const lines = shape.text.split('\n')
      lines.forEach((line, i) => {
        ctx.fillText(line, shape.x, shape.y + i * shape.fontSize * 1.3)
      })
      break
    }
    case 'number': {
      const r = 11
      ctx.beginPath()
      ctx.arc(shape.x, shape.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 13px "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(shape.n), shape.x, shape.y + 0.5)
      break
    }
  }
  ctx.restore()
}

/** 由冻结帧生成马赛克底图（10px 块状像素化） */
export function buildMosaicCanvas(
  img: HTMLImageElement,
  cssW: number,
  cssH: number,
  block = 10
): HTMLCanvasElement {
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(cssW / block))
  small.height = Math.max(1, Math.round(cssH / block))
  const sctx = small.getContext('2d')!
  sctx.drawImage(img, 0, 0, small.width, small.height)

  const mosaic = document.createElement('canvas')
  mosaic.width = cssW
  mosaic.height = cssH
  const mctx = mosaic.getContext('2d')!
  mctx.imageSmoothingEnabled = false
  mctx.drawImage(small, 0, 0, cssW, cssH)
  return mosaic
}

/** 将冻结帧选区 + 标注合成为最终图片（物理分辨率 PNG dataURL） */
export function compositeSelection(
  img: HTMLImageElement,
  ratio: number,
  sel: { x: number; y: number; width: number; height: number },
  shapes: Shape[],
  mosaicCanvas: HTMLCanvasElement | null,
  cssW: number,
  cssH: number
): string {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sel.width * ratio))
  out.height = Math.max(1, Math.round(sel.height * ratio))
  const ctx = out.getContext('2d')!
  ctx.scale(ratio, ratio)
  ctx.translate(-sel.x, -sel.y)
  ctx.drawImage(img, 0, 0, cssW, cssH)
  ctx.save()
  ctx.beginPath()
  ctx.rect(sel.x, sel.y, sel.width, sel.height)
  ctx.clip()
  for (const s of shapes) {
    drawShape(ctx, s, mosaicCanvas, cssW, cssH)
  }
  ctx.restore()
  return out.toDataURL('image/png')
}
