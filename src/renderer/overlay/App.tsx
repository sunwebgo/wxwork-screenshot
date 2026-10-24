import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { OverlayInfo, Rect } from '../../shared/types'
import { LINE_WIDTHS, FONT_SIZES, PRIMARY } from './lib/palette'
import {
  buildMosaicCanvas,
  compositeSelection,
  drawShape,
  type Point,
  type Shape,
  type ToolKind
} from './lib/shapes'
import Magnifier from './components/Magnifier'
import Toolbar from './components/Toolbar'
import TextEditor from './components/TextEditor'
import OcrPanel, { type OcrState } from './components/OcrPanel'

type Phase = 'idle' | 'dragging' | 'selected'
type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Hover = HandlePos | 'inside' | 'outside' | null

type DragState =
  | { mode: 'select'; startX: number; startY: number }
  | { mode: 'move'; startX: number; startY: number; origSel: Rect }
  | { mode: 'resize'; handle: HandlePos; origSel: Rect }
  | { mode: 'draw'; draft: Shape }
  | { mode: 'text'; x: number; y: number }

// ---- 撤销/重做 ----
interface HistState {
  shapes: Shape[]
  undo: Shape[][]
  redo: Shape[][]
}
type HistAction =
  | { type: 'add'; shape: Shape }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }

function histReducer(s: HistState, a: HistAction): HistState {
  switch (a.type) {
    case 'add':
      return { shapes: [...s.shapes, a.shape], undo: [...s.undo, s.shapes], redo: [] }
    case 'undo': {
      if (!s.undo.length) return s
      const prev = s.undo[s.undo.length - 1]
      return { shapes: prev, undo: s.undo.slice(0, -1), redo: [...s.redo, s.shapes] }
    }
    case 'redo': {
      if (!s.redo.length) return s
      const next = s.redo[s.redo.length - 1]
      return { shapes: next, undo: [...s.undo, s.shapes], redo: s.redo.slice(0, -1) }
    }
    case 'clear':
      return { shapes: [], undo: [], redo: [] }
  }
}

// ---- 几何工具函数 ----
function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

function clampRect(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.min(W, r.x))
  const y = Math.max(0, Math.min(H, r.y))
  return {
    x,
    y,
    width: Math.max(0, Math.min(W - x, r.width)),
    height: Math.max(0, Math.min(H - y, r.height))
  }
}

function inRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function handlePoints(sel: Rect): Array<{ pos: HandlePos; x: number; y: number }> {
  const cx = sel.x + sel.width / 2
  const cy = sel.y + sel.height / 2
  const right = sel.x + sel.width
  const bottom = sel.y + sel.height
  return [
    { pos: 'nw', x: sel.x, y: sel.y },
    { pos: 'n', x: cx, y: sel.y },
    { pos: 'ne', x: right, y: sel.y },
    { pos: 'e', x: right, y: cy },
    { pos: 'se', x: right, y: bottom },
    { pos: 's', x: cx, y: bottom },
    { pos: 'sw', x: sel.x, y: bottom },
    { pos: 'w', x: sel.x, y: cy }
  ]
}

function hitHandle(sel: Rect, p: Point): HandlePos | null {
  for (const hp of handlePoints(sel)) {
    if (Math.abs(p.x - hp.x) <= 5 && Math.abs(p.y - hp.y) <= 5) return hp.pos
  }
  return null
}

function numCount(shapes: Shape[]): number {
  let n = 0
  for (const s of shapes) if (s.kind === 'number') n = Math.max(n, s.n)
  return n
}

export default function App() {
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [deactivated, setDeactivated] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [sel, setSel] = useState<Rect | null>(null)
  const [tool, setTool] = useState<ToolKind | null>(null)
  const [color, setColor] = useState('#F5222D')
  const [lineWidthIdx, setLineWidthIdx] = useState(0)
  const [hist, dispatchHist] = useReducer(histReducer, { shapes: [], undo: [], redo: [] })
  const [draftShape, setDraftShape] = useState<Shape | null>(null)
  const [textEdit, setTextEdit] = useState<Point | null>(null)
  const [ocr, setOcr] = useState<OcrState>({ open: false, loading: false, text: '', error: null })
  const [mouse, setMouse] = useState<Point>({ x: -1, y: -1 })
  const [hover, setHover] = useState<Hover>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const mosaicRef = useRef<HTMLCanvasElement | null>(null)
  const shapeIdRef = useRef(1)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const annoRef = useRef<HTMLCanvasElement>(null)
  const ocrReqRef = useRef(0)
  const finishingRef = useRef(false)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2600)
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    }
  }, [])

  const W = info?.bounds.width ?? 0
  const H = info?.bounds.height ?? 0

  // ---- 初始化 ----
  useEffect(() => {
    const d = Number(new URLSearchParams(window.location.search).get('d') ?? '0')
    void window.api.getOverlayInfo(d).then((inf) => {
      if (!inf) {
        showNotice('屏幕画面初始化失败')
        return
      }
      setInfo(inf)
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => {
        setImg(im)
        window.api.notifyOverlayReady()
      }
      im.onerror = () => {
        console.error('freeze frame load failed:', inf.imageUrl)
        showNotice('截图画面加载失败，请重试')
        void window.api.cancel()
      }
      im.src = inf.imageUrl
    })
    const off = window.api.onDeactivate(() => {
      ocrReqRef.current++
      setDeactivated(true)
      setPhase('idle')
      setSel(null)
      setDraftShape(null)
      setTextEdit(null)
      setOcr((s) => ({ ...s, open: false }))
      dragRef.current = null
    })
    return off
  }, [showNotice])

  // ---- 马赛克底图 ----
  useEffect(() => {
    if (img && info) {
      mosaicRef.current = buildMosaicCanvas(img, info.bounds.width, info.bounds.height)
    }
  }, [img, info])

  // ---- 画布绘制 ----
  useEffect(() => {
    if (!img || !info) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(W * dpr)
    const ph = Math.round(H * dpr)

    const mask = maskRef.current
    if (mask) {
      if (mask.width !== pw || mask.height !== ph) {
        mask.width = pw
        mask.height = ph
      }
      const ctx = mask.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      if (!sel) {
        ctx.fillRect(0, 0, W, H)
      } else {
        const { x, y, width: w, height: h } = sel
        ctx.fillRect(0, 0, W, y)
        ctx.fillRect(0, y, x, h)
        ctx.fillRect(x + w, y, W - x - w, h)
        ctx.fillRect(0, y + h, W, H - y - h)
        // 选区边框
        ctx.strokeStyle = PRIMARY
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
        // 控制点
        if (phase === 'selected') {
          for (const hp of handlePoints(sel)) {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(hp.x - 4, hp.y - 4, 8, 8)
            ctx.strokeRect(hp.x - 3.5, hp.y - 3.5, 7, 7)
          }
        }
        // 尺寸角标
        if (phase === 'dragging' && w > 2 && h > 2) {
          const label = `${Math.round(w)} × ${Math.round(h)}`
          ctx.font = '12px "Microsoft YaHei", sans-serif'
          const tw = ctx.measureText(label).width
          const bw = tw + 14
          const bh = 20
          const bx = Math.max(0, Math.min(W - bw, x))
          const by = y - bh - 6 < 0 ? y + 6 : y - bh - 6
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
          ctx.beginPath()
          ctx.roundRect(bx, by, bw, bh, 3)
          ctx.fill()
          ctx.fillStyle = '#FFFFFF'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, bx + 7, by + bh / 2 + 0.5)
        }
      }
    }

    const anno = annoRef.current
    if (anno) {
      if (anno.width !== pw || anno.height !== ph) {
        anno.width = pw
        anno.height = ph
      }
      const ctx = anno.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (sel) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(sel.x, sel.y, sel.width, sel.height)
        ctx.clip()
        for (const s of hist.shapes) drawShape(ctx, s, mosaicRef.current, W, H)
        if (draftShape) drawShape(ctx, draftShape, mosaicRef.current, W, H)
        ctx.restore()
      }
    }
  }, [img, info, sel, phase, hist.shapes, draftShape, W, H])

  // ---- 键盘 ----
  const closeOcr = useCallback(() => {
    ocrReqRef.current++
    setOcr((s) => ({ ...s, open: false }))
  }, [])

  const finish = useCallback(
    async (action: 'copy' | 'save' | 'pin') => {
      if (!img || !sel || !info || finishingRef.current) return
      finishingRef.current = true
      try {
        const ratio = img.naturalWidth / info.bounds.width
        const dataUrl = compositeSelection(
          img,
          ratio,
          sel,
          hist.shapes,
          mosaicRef.current,
          info.bounds.width,
          info.bounds.height
        )
        if (action === 'copy') {
          const ok = await window.api.confirmCopy(dataUrl)
          if (!ok) showNotice('复制到剪贴板失败，请重试')
        } else if (action === 'save') {
          const saved = await window.api.confirmSave(dataUrl)
          if (!saved) return
        } else {
          await window.api.confirmPin(dataUrl, sel)
        }
      } catch (err) {
        console.error('confirm action failed:', err)
        showNotice('操作失败，请重试')
      } finally {
        finishingRef.current = false
      }
    },
    [img, sel, info, hist.shapes, showNotice]
  )

  const openOcr = useCallback(async () => {
    if (!img || !sel || !info) return
    const requestId = ++ocrReqRef.current
    const ratio = img.naturalWidth / info.bounds.width
    const dataUrl = compositeSelection(
      img,
      ratio,
      sel,
      hist.shapes,
      mosaicRef.current,
      info.bounds.width,
      info.bounds.height
    )
    setOcr({ open: true, loading: true, text: '', error: null })
    try {
      const res = await window.api.ocr(dataUrl)
      if (ocrReqRef.current !== requestId) return
      setOcr({
        open: true,
        loading: false,
        text: res.text ?? '',
        error: res.ok ? null : (res.error ?? '识别失败')
      })
    } catch (err) {
      if (ocrReqRef.current !== requestId) return
      setOcr({
        open: true,
        loading: false,
        text: '',
        error: err instanceof Error ? err.message : '识别失败'
      })
    }
  }, [img, sel, info, hist.shapes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.key === 'Escape') {
        e.preventDefault()
        if (textEdit) {
          setTextEdit(null)
          return
        }
        if (ocr.open) {
          closeOcr()
          return
        }
        void window.api.cancel()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') {
        e.preventDefault()
        dispatchHist({ type: 'undo' })
      } else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) {
        e.preventDefault()
        dispatchHist({ type: 'redo' })
      } else if (e.key === 'Enter' && phase === 'selected' && !textEdit && !ocr.open) {
        e.preventDefault()
        void finish('copy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, textEdit, ocr.open, finish, closeOcr])

  // ---- 指针交互 ----
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!info || !img) return
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (deactivated) {
      setDeactivated(false)
      closeOcr()
    }
    window.api.activate(info.displayId)

    const pt = { x: e.clientX, y: e.clientY }
    if (phase === 'idle') {
      dragRef.current = { mode: 'select', startX: pt.x, startY: pt.y }
      setSel({ x: pt.x, y: pt.y, width: 0, height: 0 })
      setPhase('dragging')
      return
    }
    if (phase !== 'selected' || !sel) return

    const handle = hitHandle(sel, pt)
    if (handle) {
      dragRef.current = { mode: 'resize', handle, origSel: { ...sel } }
      return
    }
    if (!inRect(pt, sel)) {
      // 选区外：重新框选
      dispatchHist({ type: 'clear' })
      setTool(null)
      closeOcr()
      dragRef.current = { mode: 'select', startX: pt.x, startY: pt.y }
      setSel({ x: pt.x, y: pt.y, width: 0, height: 0 })
      setPhase('dragging')
      return
    }
    if (!tool) {
      dragRef.current = { mode: 'move', startX: pt.x, startY: pt.y, origSel: { ...sel } }
    } else if (tool === 'text') {
      // 等 pointerup 再挂载输入框：如果 pointerdown 就挂载，紧接着的
      // mouseup/click 默认行为会把焦点抢走，textarea 刚出现就 blur 提交空内容。
      dragRef.current = { mode: 'text', x: pt.x, y: pt.y }
    } else if (tool === 'number') {
      dispatchHist({
        type: 'add',
        shape: {
          id: shapeIdRef.current++,
          kind: 'number',
          x: pt.x,
          y: pt.y,
          n: numCount(hist.shapes) + 1,
          color,
          lineWidth: LINE_WIDTHS[lineWidthIdx]
        }
      })
    } else {
      const lw = LINE_WIDTHS[lineWidthIdx]
      let draft: Shape
      switch (tool) {
        case 'rect':
          draft = { id: shapeIdRef.current++, kind: 'rect', x: pt.x, y: pt.y, w: 0, h: 0, color, lineWidth: lw }
          break
        case 'ellipse':
          draft = { id: shapeIdRef.current++, kind: 'ellipse', x: pt.x, y: pt.y, w: 0, h: 0, color, lineWidth: lw }
          break
        case 'arrow':
          draft = { id: shapeIdRef.current++, kind: 'arrow', x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color, lineWidth: lw }
          break
        case 'brush':
          draft = { id: shapeIdRef.current++, kind: 'brush', points: [pt], color, lineWidth: lw }
          break
        default:
          draft = { id: shapeIdRef.current++, kind: 'mosaic', points: [pt], color, lineWidth: lw }
      }
      dragRef.current = { mode: 'draw', draft }
      setDraftShape(draft)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = { x: e.clientX, y: e.clientY }
    if (phase === 'idle' || phase === 'dragging') setMouse(pt)
    const d = dragRef.current
    if (!d) {
      if (phase === 'selected' && sel) {
        const h = hitHandle(sel, pt)
        const hv: Hover = h ?? (inRect(pt, sel) ? 'inside' : 'outside')
        setHover((prev) => (prev === hv ? prev : hv))
      }
      return
    }
    switch (d.mode) {
      case 'select': {
        setSel(clampRect(normRect(d.startX, d.startY, pt.x, pt.y), W, H))
        break
      }
      case 'move': {
        const nx = Math.max(0, Math.min(W - d.origSel.width, d.origSel.x + (pt.x - d.startX)))
        const ny = Math.max(0, Math.min(H - d.origSel.height, d.origSel.y + (pt.y - d.startY)))
        setSel({ ...d.origSel, x: nx, y: ny })
        break
      }
      case 'resize': {
        const o = d.origSel
        let x1 = o.x
        let y1 = o.y
        let x2 = o.x + o.width
        let y2 = o.y + o.height
        if (d.handle.includes('w')) x1 = pt.x
        if (d.handle.includes('e')) x2 = pt.x
        if (d.handle.includes('n')) y1 = pt.y
        if (d.handle.includes('s')) y2 = pt.y
        setSel(clampRect(normRect(x1, y1, x2, y2), W, H))
        break
      }
      case 'draw': {
        const draft = d.draft
        let updated: Shape = draft
        if (draft.kind === 'rect' || draft.kind === 'ellipse') {
          const r = normRect(draft.x, draft.y, pt.x, pt.y)
          updated = { ...draft, x: r.x, y: r.y, w: r.width, h: r.height }
        } else if (draft.kind === 'arrow') {
          updated = { ...draft, x2: pt.x, y2: pt.y }
        } else if (draft.kind === 'brush' || draft.kind === 'mosaic') {
          const last = draft.points[draft.points.length - 1]
          if (Math.hypot(pt.x - last.x, pt.y - last.y) > 2) {
            updated = { ...draft, points: [...draft.points, pt] }
          }
        }
        if (updated !== draft) {
          dragRef.current = { mode: 'draw', draft: updated }
          setDraftShape(updated)
        }
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!d) return
    const pt = { x: e.clientX, y: e.clientY }
    if (d.mode === 'select') {
      const finalRect = clampRect(normRect(d.startX, d.startY, pt.x, pt.y), W, H)
      if (finalRect.width >= 3 && finalRect.height >= 3) {
        setSel(finalRect)
        setPhase('selected')
      } else {
        setSel(null)
        setPhase('idle')
      }
    } else if (d.mode === 'move') {
      const nx = Math.max(0, Math.min(W - d.origSel.width, d.origSel.x + (pt.x - d.startX)))
      const ny = Math.max(0, Math.min(H - d.origSel.height, d.origSel.y + (pt.y - d.startY)))
      setSel({ ...d.origSel, x: nx, y: ny })
    } else if (d.mode === 'resize') {
      const o = d.origSel
      let x1 = o.x
      let y1 = o.y
      let x2 = o.x + o.width
      let y2 = o.y + o.height
      if (d.handle.includes('w')) x1 = pt.x
      if (d.handle.includes('e')) x2 = pt.x
      if (d.handle.includes('n')) y1 = pt.y
      if (d.handle.includes('s')) y2 = pt.y
      setSel(clampRect(normRect(x1, y1, x2, y2), W, H))
    } else if (d.mode === 'text') {
      setTextEdit({ x: d.x, y: d.y })
    } else if (d.mode === 'draw') {
      let s: Shape = d.draft
      if (s.kind === 'rect' || s.kind === 'ellipse') {
        const r = normRect(s.x, s.y, pt.x, pt.y)
        s = { ...s, x: r.x, y: r.y, w: r.width, h: r.height }
      } else if (s.kind === 'arrow') {
        s = { ...s, x2: pt.x, y2: pt.y }
      } else if (s.kind === 'brush' || s.kind === 'mosaic') {
        const last = s.points[s.points.length - 1]
        if (Math.hypot(pt.x - last.x, pt.y - last.y) > 1) {
          s = { ...s, points: [...s.points, pt] }
        }
      }
      setDraftShape(null)
      let keep = false
      if (s.kind === 'brush' || s.kind === 'mosaic') keep = s.points.length > 1
      else if (s.kind === 'arrow') keep = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 3
      else if (s.kind === 'rect' || s.kind === 'ellipse') keep = s.w > 2 && s.h > 2
      if (keep) dispatchHist({ type: 'add', shape: s })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (draftShape) {
      setDraftShape(null)
      dragRef.current = null
      return
    }
    void window.api.cancel()
  }

  const commitText = (text: string) => {
    if (!textEdit) return
    dispatchHist({
      type: 'add',
      shape: {
        id: shapeIdRef.current++,
        kind: 'text',
        x: textEdit.x,
        y: textEdit.y,
        text,
        fontSize: FONT_SIZES[lineWidthIdx],
        color,
        lineWidth: LINE_WIDTHS[lineWidthIdx]
      }
    })
    setTextEdit(null)
  }

  if (!info || !img) return <div className="overlay" />

  const cursor = (() => {
    if (phase !== 'selected') return 'crosshair'
    if (hover === 'nw' || hover === 'se') return 'nwse-resize'
    if (hover === 'ne' || hover === 'sw') return 'nesw-resize'
    if (hover === 'n' || hover === 's') return 'ns-resize'
    if (hover === 'e' || hover === 'w') return 'ew-resize'
    if (hover === 'inside') return tool ? 'crosshair' : 'move'
    return 'crosshair'
  })()

  const OCR_W = 320
  const OCR_H = 260
  let ocrX = sel ? Math.max(8, Math.min(W - OCR_W - 8, sel.x + sel.width / 2 - OCR_W / 2)) : 40
  let ocrY = sel ? sel.y + sel.height + 8 : 40
  if (sel && ocrY + OCR_H > H - 8) ocrY = sel.y - OCR_H - 8
  ocrX = Math.max(8, ocrX)
  ocrY = Math.max(8, Math.min(H - OCR_H - 8, ocrY))

  return (
    <div
      className={`overlay${deactivated ? ' deactivated' : ''}`}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        if (phase === 'selected') void finish('copy')
      }}
      onContextMenu={onContextMenu}
    >
      <img className="freeze" src={info.imageUrl} draggable={false} alt="" />
      <canvas ref={maskRef} className="layer" style={{ width: W, height: H }} />
      <canvas ref={annoRef} className="layer" style={{ width: W, height: H }} />
      {deactivated && <div className="deactivate-mask" />}
      {!deactivated && (phase === 'idle' || phase === 'dragging') && (
        <Magnifier image={img} cssW={W} cssH={H} x={mouse.x} y={mouse.y} />
      )}
      {phase === 'selected' && sel && !textEdit && !ocr.open && (
        <Toolbar
          sel={sel}
          viewportW={W}
          viewportH={H}
          tool={tool}
          color={color}
          lineWidthIdx={lineWidthIdx}
          canUndo={hist.undo.length > 0}
          canRedo={hist.redo.length > 0}
          onTool={setTool}
          onColor={setColor}
          onLineWidth={setLineWidthIdx}
          onUndo={() => dispatchHist({ type: 'undo' })}
          onRedo={() => dispatchHist({ type: 'redo' })}
          onPin={() => void finish('pin')}
          onOcr={() => void openOcr()}
          onSave={() => void finish('save')}
          onCancel={() => void window.api.cancel()}
          onOk={() => void finish('copy')}
        />
      )}
      {textEdit && (
        <TextEditor
          x={textEdit.x}
          y={textEdit.y}
          color={color}
          fontSize={FONT_SIZES[lineWidthIdx]}
          viewportW={W}
          viewportH={H}
          onCommit={commitText}
          onCancel={() => setTextEdit(null)}
        />
      )}
      {ocr.open && (
        <OcrPanel
          x={ocrX}
          y={ocrY}
          viewportW={W}
          viewportH={H}
          state={ocr}
          onClose={closeOcr}
        />
      )}
      {notice && <div className="overlay-toast">{notice}</div>}
    </div>
  )
}
