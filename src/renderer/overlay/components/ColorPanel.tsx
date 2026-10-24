import { COLORS, LINE_WIDTHS } from '../lib/palette'

interface Props {
  anchorLeft: number
  above: boolean
  color: string
  lineWidthIdx: number
  onColor: (c: string) => void
  onLineWidth: (i: number) => void
}

export default function ColorPanel({
  anchorLeft,
  above,
  color,
  lineWidthIdx,
  onColor,
  onLineWidth
}: Props) {
  return (
    <div
      className={`color-panel${above ? ' above' : ''}`}
      style={{ left: anchorLeft }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="color-row">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`color-swatch${c.toLowerCase() === color.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            onClick={(e) => {
              e.stopPropagation()
              onColor(c)
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={c}
          />
        ))}
      </div>
      <div className="width-row">
        {LINE_WIDTHS.map((w, i) => (
          <button
            key={w}
            className={`width-option${i === lineWidthIdx ? ' active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onLineWidth(i)
            }}
            title={`粗细 ${w}`}
          >
            <i
              className="width-dot"
              style={{
                width: 4 + i * 3,
                height: 4 + i * 3,
                background: i === lineWidthIdx ? color : '#4E5969'
              }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
