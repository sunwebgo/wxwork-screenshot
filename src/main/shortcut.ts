import { globalShortcut } from 'electron'
import { startCapture } from './capture'

export function registerShortcuts(): void {
  const ok = globalShortcut.register('Alt+A', () => {
    void startCapture()
  })
  if (!ok) {
    console.warn('注册 Alt+A 全局快捷键失败，可能被其他程序占用')
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
