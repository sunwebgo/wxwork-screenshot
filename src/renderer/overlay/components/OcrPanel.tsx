import { useEffect, useRef, useState } from 'react'

export interface OcrState {
  open: boolean
  loading: boolean
  text: string
  error: string | null
}

interface Props {
  x: number
  y: number
  viewportW: number
  viewportH: number
  state: OcrState
  onClose: () => void
}

const PANEL_W = 320
const PANEL_H = 260

export default function OcrPanel({ x, y, viewportW, viewportH, state, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const left = Math.max(8, Math.min(viewportW - PANEL_W - 8, x))
  const top = Math.max(8, Math.min(viewportH - PANEL_H - 8, y))

  const copy = async () => {
    let ok = false
    try {
      ok = await window.api.writeClipboardText(state.text)
    } catch {
      ok = false
    }
    if (!ok) {
      areaRef.current?.select()
      try {
        document.execCommand('copy')
        ok = true
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div
      className="ocr-panel"
      style={{ left, top, width: PANEL_W, height: PANEL_H }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="ocr-header">
        <span>提取文字</span>
        <button className="ocr-close" onClick={onClose} title="关闭">
          ×
        </button>
      </div>
      {state.loading ? (
        <div className="ocr-loading">
          <i className="spinner" />
          正在识别文字…
        </div>
      ) : state.error ? (
        <div className="ocr-error">{state.error}</div>
      ) : (
        <>
          <textarea ref={areaRef} className="ocr-text" readOnly value={state.text} spellCheck={false} />
          <div className="ocr-actions">
            <button className="ocr-btn primary" onClick={() => void copy()}>
              {copied ? '已复制' : '复制文字'}
            </button>
            <button className="ocr-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      )}
    </div>
  )
}
