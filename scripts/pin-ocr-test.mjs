/** 贴图 + OCR 端到端测试：触发截图 → 选区 → 点贴图（校验贴图窗口）→ 再截图 → 点 OCR（校验识别面板） */
const PORT = process.env['WXSHOT_DEBUG_PORT'] ?? '9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return res.json()
}

async function waitForOverlay() {
  for (let i = 0; i < 40; i++) {
    try {
      const overlay = (await listTargets()).find(
        (t) => t.url.includes('overlay.html') && t.webSocketDebuggerUrl
      )
      if (overlay) return overlay
    } catch {}
    await sleep(500)
  }
  throw new Error('overlay not found')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++seq
            pending.set(id, { res, rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => ws.close()
      })
    ws.onerror = reject
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      }
    }
  })
}

async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result.value
}

async function drag(cdp, x1, y1, x2, y2) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1
  })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x1 + ((x2 - x1) * i) / 10),
      y: Math.round(y1 + ((y2 - y1) * i) / 10),
      button: 'left',
      buttons: 1
    })
    await sleep(16)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1
  })
}

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

// ---- 贴图测试 ----
async function triggerCapture() {
  const { spawn } = await import('node:child_process')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const child = spawn(process.execPath, [join(root, 'node_modules', 'electron', 'cli.js'), '.'], {
    stdio: 'ignore',
    cwd: root
  })
  child.unref()
}

await triggerCapture()
const ov = await waitForOverlay()
const cdp = await connect(ov.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await sleep(1200)
const vp = await evaluate(cdp, `({w: window.innerWidth, h: window.innerHeight})`)
await drag(cdp, Math.round(vp.w * 0.2), Math.round(vp.h * 0.2), Math.round(vp.w * 0.5), Math.round(vp.h * 0.5))
await sleep(500)
// 点贴图按钮（索引 9）
await evaluate(cdp, `document.querySelectorAll('.toolbar .tb-btn')[9].click()`)
await sleep(1500)
const pinOk = (await listTargets()).some((t) => t.url.includes('pin.html'))
check('贴图窗口创建', pinOk)

// ---- OCR 测试 ----
await triggerCapture()
const ov2 = await waitForOverlay()
const cdp2 = await connect(ov2.webSocketDebuggerUrl)
await cdp2.send('Runtime.enable')
await sleep(1200)
const vp2 = await evaluate(cdp2, `({w: window.innerWidth, h: window.innerHeight})`)
await drag(
  cdp2,
  Math.round(vp2.w * 0.25),
  Math.round(vp2.h * 0.3),
  Math.round(vp2.w * 0.7),
  Math.round(vp2.h * 0.6)
)
await sleep(500)
// 点 OCR 按钮（索引 10）
await evaluate(cdp2, `document.querySelectorAll('.toolbar .tb-btn')[10].click()`)
await sleep(800)
let ocrDone = false
let ocrInfo = ''
for (let i = 0; i < 30; i++) {
  ocrInfo = await evaluate(
    cdp2,
    `(() => {
      const panel = document.querySelector('.ocr-panel')
      if (!panel) return 'no-panel'
      const err = panel.querySelector('.ocr-error')
      if (err) return 'error: ' + err.textContent
      const txt = panel.querySelector('.ocr-text')
      if (txt) return 'text: ' + JSON.stringify(txt.value.slice(0, 120))
      return 'loading'
    })()`
  )
  if (!ocrInfo || ocrInfo === 'loading') {
    await sleep(1000)
    continue
  }
  ocrDone = true
  break
}
check('OCR 面板出结果', ocrDone && ocrInfo.startsWith('text:'), ocrInfo)
console.log('OCR 识别内容:', ocrInfo.startsWith('text:') ? ocrInfo.slice(6) : ocrInfo)
cdp.close()
cdp2.close()

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `PIN/OCR FAILED: ${failed.length} 项未通过` : 'PIN/OCR PASSED')
process.exit(failed.length ? 1 : 0)
