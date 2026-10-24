import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Rect } from '../../../shared/types'
import type { ToolKind } from '../lib/shapes'
import { LINE_WIDTHS } from '../lib/palette'
import {
  ArrowIcon,
  BrushIcon,
  CloseIcon,
  DownloadIcon,
  EllipseIcon,
  MosaicIcon,
  NumberIcon,
  OkIcon,
  OcrIcon,
  PinIcon,
  RectIcon,
  RedoIcon,
  TextIcon,
  UndoIcon
} from './icons'
import ColorPanel from './ColorPanel'

const BTN = 34 // 按钮占位（含间距）
const PAD = 6
const TB_HEIGHT = 44

interface Props {
  sel: Rect
  viewportW: number
  viewportH: number
  tool: ToolKind | null
  color: string
  lineWidthIdx: number
  canUndo: boolean
  canRedo: boolean
  onTool: (t: ToolKind | null) => void
  onColor: (c: string) => void
  onLineWidth: (i: number) => void
  onUndo: () => void
  onRedo: () => void
  onPin: () => void
  onOcr: () => void
  onSave: () => void
  onCancel: () => void
  onOk: () => void
}

const DRAW_TOOLS: Array<{ key: ToolKind; label: string; Icon: () => JSX.Element }> = [
  { key: 'rect', label: '矩形', Icon: RectIcon },
  { key: 'ellipse', label: '椭圆', Icon: EllipseIcon },
  { key: 'arrow', label: '箭头', Icon: ArrowIcon },
  { key: 'brush', label: '画笔', Icon: BrushIcon },
  { key: 'mosaic', label: '马赛克', Icon: MosaicIcon },
  { key: 'text', label: '文字', Icon: TextIcon },
  { key: 'number', label: '序号', Icon: NumberIcon }
]

export default function Toolbar(props: Props) {
  const {
    sel,
    viewportW,
    viewportH,
    tool,
    color,
    lineWidthIdx,
    canUndo,
    canRedo,
    onTool,
    onColor,
    onLineWidth,
    onUndo,
    onRedo,
    onPin,
    onOcr,
    onSave,
    onCancel,
    onOk
  } = props

  const [panelOpen, setPanelOpen] = useState(false)
  const [panelAnchor, setPanelAnchor] = useState(0)
  const [width, setWidth] = useState(520)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth)
  }, [])

  useEffect(() => {
    if (tool === null) setPanelOpen(false)
  }, [tool])

  let left = sel.x + sel.width / 2 - width / 2
  left = Math.max(8, Math.min(viewportW - width - 8, left))
  let top = sel.y + sel.height + 8
  if (top + TB_HEIGHT > viewportH - 8) top = sel.y - 8 - TB_HEIGHT
  top = Math.max(8, top)

  // 色板默认在工具栏下方；靠近屏幕底部时翻到工具栏上方，避免被裁掉
  const PANEL_W = 240
  const PANEL_H = 100
  const panelAbove = top + TB_HEIGHT + PANEL_H + 8 > viewportH && top - PANEL_H - 8 >= 8
  let colorLeft = PAD + panelAnchor * BTN
  colorLeft = Math.max(4, Math.min(viewportW - left - PANEL_W - 8, colorLeft))

  const clickTool = (key: ToolKind, idx: number) => {
    if (tool === key) {
      onTool(null)
      setPanelOpen(false)
      return
    }
    onTool(key)
    setPanelAnchor(idx)
    setPanelOpen(true)
  }

  const actionBtn = (
    key: string,
    label: string,
    Icon: () => JSX.Element,
    onClick: () => void,
    disabled = false,
    extraClass = ''
  ) => (
    <button
      key={key}
      className={`tb-btn ${extraClass}`}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Icon />
    </button>
  )

  const divider = (i: number) => <i key={`d${i}`} className="tb-divider" />

  const buttons: React.ReactNode[] = []
  DRAW_TOOLS.forEach(({ key, label, Icon }, idx) => {
    buttons.push(
      <button
        key={key}
        className={`tb-btn draw${tool === key ? ' active' : ''}`}
        title={label}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          clickTool(key, idx)
        }}
      >
        <Icon />
        <i className="color-dot" style={{ background: color }} />
      </button>
    )
  })
  let di = DRAW_TOOLS.length
  buttons.push(divider(di++))
  buttons.push(actionBtn('undo', '撤销', UndoIcon, onUndo, !canUndo))
  buttons.push(actionBtn('redo', '重做', RedoIcon, onRedo, !canRedo))
  buttons.push(divider(di++))
  buttons.push(actionBtn('pin', '贴图', PinIcon, onPin))
  buttons.push(actionBtn('ocr', '提取文字', OcrIcon, onOcr))
  buttons.push(divider(di++))
  buttons.push(actionBtn('save', '下载', DownloadIcon, onSave))
  buttons.push(divider(di++))
  buttons.push(actionBtn('cancel', '取消', CloseIcon, onCancel, false, 'danger'))
  buttons.push(actionBtn('ok', '确定', OkIcon, onOk, false, 'primary'))

  return (
    <div
      ref={ref}
      className="toolbar"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {buttons}
      {panelOpen && (
        <ColorPanel
          anchorLeft={colorLeft}
          above={panelAbove}
          color={color}
          lineWidthIdx={lineWidthIdx}
          onColor={onColor}
          onLineWidth={(i) => onLineWidth(i)}
        />
      )}
    </div>
  )
}
