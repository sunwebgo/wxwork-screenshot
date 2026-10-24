import { app } from 'electron'
import { existsSync } from 'fs'
import { readSettings, writeSettings } from './settings'

interface LaunchTarget {
  path: string
  args: string[]
}

const debug = process.env['WXSHOT_DEBUG'] === '1'

function launchTarget(): LaunchTarget {
  const portable = process.env['PORTABLE_EXECUTABLE_FILE']
  if (portable && existsSync(portable)) {
    // electron-builder portable 会把程序解压到临时目录运行，
    // 注册表必须指向用户双击的那个便携 exe，而不是临时进程。
    return { path: portable, args: [] }
  }
  if (app.isPackaged) return { path: process.execPath, args: [] }
  // 开发模式：只记录偏好，不写系统启动项，避免把 electron.exe 加到开机启动
  return { path: process.execPath, args: [app.getAppPath()] }
}

function apply(enabled: boolean): void {
  if (!app.isPackaged) return
  const target = launchTarget()
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: target.path,
      args: target.args
    })
    if (debug) {
      const actual = app.getLoginItemSettings({ path: target.path, args: target.args })
      console.log(`[wxshot] autoLaunch=${enabled} actual=${actual.openAtLogin} path=${target.path}`)
    }
  } catch (err) {
    console.warn('set login item failed:', err)
  }
}

/** 默认开启；用户从托盘关闭后写入 settings.json，后续启动保持关闭 */
export function getAutoLaunchPreference(): boolean {
  return readSettings().autoLaunch !== false
}

export function isAutoLaunchEnabled(): boolean {
  if (!app.isPackaged) return getAutoLaunchPreference()
  const target = launchTarget()
  try {
    return app.getLoginItemSettings({ path: target.path, args: target.args }).openAtLogin
  } catch {
    return false
  }
}

export function setAutoLaunch(enabled: boolean): boolean {
  writeSettings({ autoLaunch: enabled })
  apply(enabled)
  return isAutoLaunchEnabled()
}

/** 首次运行默认写入开机自启；之后按 settings.json 的偏好应用 */
export function initAutoLaunch(): void {
  const configured = readSettings().autoLaunch
  if (configured === undefined) {
    writeSettings({ autoLaunch: true })
    apply(true)
    return
  }
  apply(configured)
}
