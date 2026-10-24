import { BrowserWindow, clipboard, dialog, nativeImage, Notification } from 'electron'
import { writeFile } from 'fs/promises'

function decodeDataUrl(dataUrl: string): Electron.NativeImage {
  return nativeImage.createFromDataURL(dataUrl)
}

function localStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function ensureImageExtension(filePath: string): string {
  return /\.[A-Za-z0-9]+$/.test(filePath) ? filePath : `${filePath}.png`
}

export function copyImageToClipboard(dataUrl: string): boolean {
  try {
    const image = decodeDataUrl(dataUrl)
    if (image.isEmpty()) return false
    clipboard.writeImage(image)
    if (Notification.isSupported()) {
      new Notification({
        title: '截图完成',
        body: '截图已复制到剪贴板',
        silent: true
      }).show()
    }
    return true
  } catch (err) {
    console.error('copy to clipboard failed:', err)
    return false
  }
}

export async function saveImageDialog(win: BrowserWindow | null, dataUrl: string): Promise<string | null> {
  if (!win) return null
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '保存截图',
    defaultPath: `截图_${localStamp()}.png`,
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }
    ]
  })
  if (canceled || !filePath) return null
  const target = ensureImageExtension(filePath)
  const image = decodeDataUrl(dataUrl)
  const isJpg = /\.jpe?g$/i.test(target)
  const buf = isJpg ? image.toJPEG(92) : image.toPNG()
  try {
    await writeFile(target, buf)
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : String(err)
    })
    return null
  }
  return target
}
