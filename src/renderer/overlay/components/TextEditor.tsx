import { useEffect, useRef, useState } from 'react'

interface Props {
  x: number
  y: number
  color: string
  fontSize: number
  viewportW: number
  viewportH: number
  onCommit: (text: string) => void
  onCancel: () => void
}

export default function TextEditor({
  x,
  y,
  color,
  fontSize,
  viewportW,
  viewportH,
  onCommit,
  onCancel
}: Props) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const doneRef = useRef(false)

  const resize = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(fontSize * 1.5, el.scrollHeight)}px`
  }

  useEffect(() => {
    ref.current?.focus()
    resize()
  }, [])

  const commit = (): void => {
    if (doneRef.current) return
    doneRef.current = true
    if (value.trim()) onCommit(value)
    else onCancel()
  }

  const cancel = (): void => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }

  const boxWidth = 260
  const boxHeight = fontSize * 1.5 + 34
  const left = Math.max(4, Math.min(x, viewportW - boxWidth - 4))
  const top = Math.max(4, Math.min(y, viewportH - boxHeight - 4))

  const keepFocus = (e: React.PointerEvent | React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      className="text-editor-box"
      style={{ left, top, width: boxWidth }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="text-editor"
        style={{ color, fontSize, lineHeight: 1.4 }}
        value={value}
        placeholder="输入文字…"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          requestAnimationFrame(resize)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={commit}
      />
      <div className="text-editor-bar" onPointerDown={keepFocus} onMouseDown={keepFocus}>
        <span className="text-editor-hint" title="Enter 完成；Shift+Enter 换行；Esc 取消">
          Enter 完成 · Shift+Enter 换行
        </span>
        <button
          type="button"
          className="te-btn te-cancel"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={cancel}
        >
          取消
        </button>
        <button
          type="button"
          className="te-btn te-ok"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={commit}
        >
          完成
        </button>
      </div>
    </div>
  )
}
