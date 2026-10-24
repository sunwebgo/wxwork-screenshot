import { Menu, Tray, app } from 'electron'
import { join } from 'path'
import { startCapture, isCapturing } from './capture'
import { closeAllPins } from './pin-window'
import { isAutoLaunchEnabled, setAutoLaunch } from './auto-launch'

let tray: Tray | null = null

export function getResourcesPath(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}

export function createTray(): Tray {
  const iconPath = join(getResourcesPath(), 'tray.png')
  tray = new Tray(iconPath)
  tray.setToolTip('截图工具 (Alt+A)')
  const menu = Menu.buildFromTemplate([
    {
      label: '截图 (Alt+A)',
      click: () => void startCapture()
    },
    {
      label: '清除全部贴图',
      click: () => closeAllPins()
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (item) => {
        item.checked = setAutoLaunch(item.checked)
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => {
    if (!isCapturing()) void startCapture()
  })
  return tray
}
