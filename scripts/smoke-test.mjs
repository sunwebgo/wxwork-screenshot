/**
 * 冒烟测试：通过 CDP 驱动截图遮罩窗口完成一次完整截图流程。
 * 前置：WXSHOT_DEBUG_PORT=9222 WXSHOT_SELFTEST=1 启动 dev。
 * 流程：等待遮罩窗口出现 → 校验冻结帧/放大镜 → 拖拽选区 → 校验工具栏 → 双击确认 → 校验窗口关闭。
 */
const PORT = process.env['WXSHOT_DEBUG_PORT'] ?? '9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return res.json()
}

async function waitForOverlay() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await listTargets()
      const overlay = targets.find((t) => t.url.includes('overlay.html') && t.webSocketDebuggerUrl)
      if (overlay) return overlay
    } catch {
      /* dev server 未就绪 */
    }
    await sleep(500)
  }
  throw new Error('overlay window not found within timeout')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    const consoleErrors = []
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++seq
            pending.set(id, { res, rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        errors: consoleErrors,
        close: () => ws.close()
      })
    ws.onerror = reject
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params?.exceptionDetails?.text ?? 'exception')
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        consoleErrors.push(JSON.stringify(msg.params?.args ?? []))
      }
    }
  })
}

async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

async function drag(cdp, x1, y1, x2, y2) {
  const steps = 12
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: x1,
    y: y1,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x1 + ((x2 - x1) * i) / steps),
      y: Math.round(y1 + ((y2 - y1) * i) / steps),
      button: 'left',
      buttons: 1
    })
    await sleep(16)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x2,
    y: y2,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const overlay = await waitForOverlay()
const cdp = await connect(overlay.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await sleep(1500)

// 1. 冻结帧已加载
const imgOk = await evaluate(
  cdp,
  `(() => { const i = document.querySelector('img.freeze'); return !!i && i.naturalWidth > 0 && i.naturalHeight > 0 })()`
)
check('冻结帧加载', imgOk)

// 2. 放大镜存在
const magOk = await evaluate(cdp, `!!document.querySelector('.magnifier')`)
check('放大镜渲染', magOk)

// 3. 拖拽出选区 → 工具栏出现
const vp = await evaluate(cdp, `({w: window.innerWidth, h: window.innerHeight})`)
await drag(cdp, Math.round(vp.w * 0.25), Math.round(vp.h * 0.25), Math.round(vp.w * 0.65), Math.round(vp.h * 0.65))
await sleep(600)
const selOk = await evaluate(
  cdp,
  `(() => { const s = App_selectedRect(); return !!s })()`.replace(
    'App_selectedRect()',
    `!!document.querySelector('.toolbar')`
  )
)
check('选区+工具栏', selOk)

// 4. 工具栏按钮数量（7 绘制 + undo/redo + pin/ocr + save + cancel/ok = 14）
const btnCount = await evaluate(cdp, `document.querySelectorAll('.toolbar .tb-btn').length`)
check('工具栏按钮', btnCount === 14, `实际 ${btnCount}`)

// 5. 选择画笔并画一笔 → 撤销可用、重做不可用
await evaluate(cdp, `document.querySelectorAll('.toolbar .tb-btn')[3].click()`)
await drag(
  cdp,
  Math.round(vp.w * 0.3),
  Math.round(vp.h * 0.3),
  Math.round(vp.w * 0.5),
  Math.round(vp.h * 0.4)
)
await sleep(300)
const undoEnabled = await evaluate(
  cdp,
  `(() => { const b = document.querySelectorAll('.toolbar .tb-btn'); return !b[7].disabled && b[8].disabled })()`
)
check('画笔绘制+撤销可用', undoEnabled)

// 6. 双击确认 → 窗口应关闭（剪贴板写入）
// 触发后页面随即销毁，不等待 evaluate 响应
cdp
  .send('Runtime.evaluate', {
    expression: `document.querySelector('.overlay').dispatchEvent(new MouseEvent('dblclick', {bubbles: true, clientX: ${Math.round(vp.w * 0.45)}, clientY: ${Math.round(vp.h * 0.45)}}))`,
    returnByValue: true
  })
  .catch(() => {})
await sleep(1500)
let closed = true
try {
  const targets = await listTargets()
  closed = !targets.some((t) => t.url.includes('overlay.html'))
} catch {
  closed = true
}
check('双击确认并关闭遮罩', closed)

check('渲染层无 JS 错误', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '))
cdp.close()

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `SMOKE FAILED: ${failed.length} 项未通过` : 'SMOKE PASSED')
process.exit(failed.length ? 1 : 0)
