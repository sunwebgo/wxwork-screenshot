import { app } from 'electron'
import { registerCaptureProtocolHandler, registerCaptureScheme } from './protocol'
import { registerOverlayIpc, startCapture } from './capture'
import { destroyCaptureService, registerCaptureServiceIpc } from './capture-service'
import { destroyGdiCapture, initGdiCapture } from './gdi-capture'
import { registerPinIpc, closeAllPins } from './pin-window'
import { registerOcrIpc } from './ocr'
import { createTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './shortcut'
import { initAutoLaunch } from './auto-launch'

// 调试辅助：WXSHOT_DEBUG_PORT=9222 开 CDP；WXSHOT_SELFTEST=1 启动后自动截图（冒烟测试用）
if (process.env['WXSHOT_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['WXSHOT_DEBUG_PORT'])
}
if (process.env['WXSHOT_SELFTEST']) {
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void startCapture()
  })

  // 必须在 app ready 之前注册自定义协议
  registerCaptureScheme()

  app.whenReady().then(() => {
    app.setAppUserModelId('com.wxwork.screenshot')
    registerCaptureProtocolHandler()
    registerOverlayIpc()
    registerCaptureServiceIpc()
    registerPinIpc()
    registerOcrIpc()
    initAutoLaunch()
    createTray()
    registerShortcuts()
    // 常驻 GDI 抓屏助手：启动后常驻，Alt+A 时直接抓当前帧（不含鼠标指针）
    setTimeout(() => {
      void initGdiCapture().catch((err) => console.warn('GDI capture helper unavailable:', err))
    }, 300)
    if (process.env['WXSHOT_SELFTEST']) {
      setTimeout(() => void startCapture(), 2500)
    }
  })

  // 托盘常驻应用：所有窗口关闭也不退出
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    unregisterShortcuts()
    closeAllPins()
    destroyCaptureService()
    destroyGdiCapture()
  })
}
