import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../shared/types'
import { ensureCaptureDir } from './protocol'
import { getResourcesPath } from './tray'

/** 调用 Windows 自带 OCR（Windows.Media.Ocr）识别 PNG 图片中的文字 */
export async function extractText(dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  const file = join(ensureCaptureDir(), `ocr-${randomUUID()}.png`)
  await writeFile(file, Buffer.from(base64, 'base64'))
  try {
    const script = join(getResourcesPath(), 'ocr.ps1')
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-ImagePath',
          file
        ],
        { windowsHide: true }
      )
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (err += d.toString()))
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve(out)
        else reject(new Error(err.trim() || `OCR 进程退出码 ${code}`))
      })
    })
    return stdout.replace(/\r\n/g, '\n').trim()
  } finally {
    unlink(file).catch(() => {})
  }
}

/** OCR 错误码 → 用户可读的中文提示 */
function friendlyError(message: string): string {
  if (message.includes('NO_OCR_ENGINE')) {
    return '系统未安装 OCR 语言包，请在「设置 - 时间和语言 - 语言」中添加中文或英文语言后重试'
  }
  return message || '识别失败'
}

export function registerOcrIpc(): void {
  ipcMain.handle(IPC.OCR_EXTRACT, async (_e, dataUrl: string) => {
    try {
      return { ok: true, text: await extractText(dataUrl) }
    } catch (err) {
      return {
        ok: false,
        error: friendlyError(err instanceof Error ? err.message : String(err))
      }
    }
  })
}
