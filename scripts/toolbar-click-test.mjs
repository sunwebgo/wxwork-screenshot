/** 真实鼠标点击工具栏测试：选区后用 CDP Input 事件点击「画笔」与「确定」，验证事件不会误穿透到遮罩层 */
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

async function realClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
  })
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

// 触发截图（第二实例唤起）
const { spawn } = await import('node:child_process')
const { join, dirname } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
spawn(
  process.execPath,
  [join(root, 'node_modules', 'electron', 'cli.js'), '.'],
  { stdio: 'ignore', cwd: root }
).unref()

const ov = await waitForOverlay()
const cdp = await connect(ov.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await sleep(1200)
const vp = await evaluate(cdp, `({w: window.innerWidth, h: window.innerHeight})`)
await drag(cdp, Math.round(vp.w * 0.25), Math.round(vp.h * 0.25), Math.round(vp.w * 0.6), Math.round(vp.h * 0.6))
await sleep(500)

// 真实点击「画笔」按钮（索引 3）
const brushPt = await evaluate(
  cdp,
  `(() => { const b = document.querySelectorAll('.toolbar .tb-btn')[3]; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`
)
await realClick(cdp, Math.round(brushPt.x), Math.round(brushPt.y))
await sleep(400)
const state1 = await evaluate(
  cdp,
  `(() => ({
    toolbar: !!document.querySelector('.toolbar'),
    active: document.querySelector('.toolbar .tb-btn.active') !== null,
    panel: !!document.querySelector('.color-panel')
  }))()`
)
check('真实点击画笔：工具栏保留且工具激活', state1.toolbar && state1.active && state1.panel, JSON.stringify(state1))

// 真实点击「确定」按钮（最后一个）
const okPt = await evaluate(
  cdp,
  `(() => { const bs = document.querySelectorAll('.toolbar .tb-btn'); const r = bs[bs.length-1].getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`
)
await realClick(cdp, Math.round(okPt.x), Math.round(okPt.y))
await sleep(1500)
let closed = true
try {
  closed = !(await listTargets()).some((t) => t.url.includes('overlay.html'))
} catch {
  closed = true
}
check('真实点击确定：确认并关闭', closed)

cdp.close()
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? 'TOOLBAR CLICK TEST FAILED' : 'TOOLBAR CLICK TEST PASSED')
process.exit(failed.length ? 1 : 0)
